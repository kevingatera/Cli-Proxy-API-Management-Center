import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useAuthStore, useConfigStore, useNotificationStore } from '@/stores';
import { apiKeysApi } from '@/services/api';
import {
  clearApiKeyLabels,
  getApiKeyDisplayLabel,
  getCustomApiKeyLabel,
  loadApiKeyLabels,
  removeCustomApiKeyLabel,
  setCustomApiKeyLabel,
} from '@/utils/apiKeyNames';
import { maskApiKey } from '@/utils/format';
import { isValidApiKeyCharset } from '@/utils/validation';
import styles from './ApiKeysPage.module.scss';

export function ApiKeysPage() {
  const { t } = useTranslation();
  const { showNotification, showConfirmation } = useNotificationStore();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);

  const config = useConfigStore((state) => state.config);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const updateConfigValue = useConfigStore((state) => state.updateConfigValue);
  const clearCache = useConfigStore((state) => state.clearCache);

  const [apiKeys, setApiKeys] = useState<string[]>([]);
  const [apiKeyLabels, setApiKeyLabels] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [labelValue, setLabelValue] = useState('');
  const [saving, setSaving] = useState(false);

  const disableControls = useMemo(() => connectionStatus !== 'connected', [connectionStatus]);

  const syncLabelsToServer = useCallback(
    async (labels: Record<string, string>) => {
      await apiKeysApi.replaceLabels(labels);
      setApiKeyLabels(labels);
    },
    []
  );

  const migrateLocalLabels = useCallback(
    async (keys: string[], serverLabels: Record<string, string>) => {
      const localLabels = loadApiKeyLabels();
      if (!Object.keys(localLabels).length) {
        return serverLabels;
      }

      let nextLabels = { ...serverLabels };
      let changed = false;
      keys.forEach((key) => {
        const localLabel = getCustomApiKeyLabel(key, localLabels);
        const serverLabel = getCustomApiKeyLabel(key, serverLabels);
        if (!localLabel || serverLabel) {
          return;
        }
        nextLabels = setCustomApiKeyLabel(nextLabels, key, localLabel);
        changed = true;
      });

      if (!changed) {
        clearApiKeyLabels();
        return serverLabels;
      }

      await syncLabelsToServer(nextLabels);
      clearApiKeyLabels();
      return nextLabels;
    },
    [syncLabelsToServer]
  );

  const loadApiKeys = useCallback(
    async (force = false) => {
      setLoading(true);
      setError('');
      try {
        const result = (await fetchConfig('api-keys', force)) as string[] | undefined;
        const list = Array.isArray(result) ? result : [];
        setApiKeys(list);
        const serverLabels = await apiKeysApi.listLabels();
        const migratedLabels = await migrateLocalLabels(list, serverLabels);
        setApiKeyLabels(migratedLabels);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : t('notification.refresh_failed'));
      } finally {
        setLoading(false);
      }
    },
    [fetchConfig, migrateLocalLabels, t]
  );

  useEffect(() => {
    void loadApiKeys();
  }, [loadApiKeys]);

  useEffect(() => {
    if (Array.isArray(config?.apiKeys)) {
      setApiKeys(config.apiKeys);
    }
  }, [config?.apiKeys]);

  useHeaderRefresh(() => loadApiKeys(true));

  const openAddModal = () => {
    setEditingIndex(null);
    setInputValue('');
    setLabelValue('');
    setModalOpen(true);
  };

  const openEditModal = (index: number) => {
    const key = apiKeys[index] ?? '';
    setEditingIndex(index);
    setInputValue(key);
    setLabelValue(getCustomApiKeyLabel(key, apiKeyLabels));
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setInputValue('');
    setLabelValue('');
    setEditingIndex(null);
  };

  const handleSave = async () => {
    const trimmed = inputValue.trim();
    if (!trimmed) {
      showNotification(`${t('notification.please_enter')} ${t('notification.api_key')}`, 'error');
      return;
    }
    if (!isValidApiKeyCharset(trimmed)) {
      showNotification(t('notification.api_key_invalid_chars'), 'error');
      return;
    }

    const isEdit = editingIndex !== null;
    const previousKey = isEdit && editingIndex !== null ? apiKeys[editingIndex] ?? '' : '';
    const nextKeys = isEdit
      ? apiKeys.map((key, idx) => (idx === editingIndex ? trimmed : key))
      : [...apiKeys, trimmed];
    let nextLabels = previousKey ? removeCustomApiKeyLabel(apiKeyLabels, previousKey) : { ...apiKeyLabels };
    nextLabels = setCustomApiKeyLabel(nextLabels, trimmed, labelValue);

    setSaving(true);
    try {
      if (isEdit && editingIndex !== null) {
        await apiKeysApi.update(editingIndex, trimmed);
        showNotification(t('notification.api_key_updated'), 'success');
      } else {
        await apiKeysApi.replace(nextKeys);
        showNotification(t('notification.api_key_added'), 'success');
      }

      await syncLabelsToServer(nextLabels);
      setApiKeys(nextKeys);
      updateConfigValue('api-keys', nextKeys);
      clearCache('api-keys');
      closeModal();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      showNotification(`${t('notification.update_failed')}: ${message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (index: number) => {
    const apiKeyToDelete = apiKeys[index];
    if (!apiKeyToDelete) {
      showNotification(t('notification.delete_failed'), 'error');
      return;
    }

    showConfirmation({
      title: t('common.delete'),
      message: t('api_keys.delete_confirm'),
      details: [
        t('api_keys.delete_detail_label', { name: getApiKeyDisplayLabel(apiKeyToDelete, apiKeyLabels) }),
        t('api_keys.delete_detail_masked', { key: maskApiKey(String(apiKeyToDelete || '')) }),
      ],
      variant: 'danger',
      confirmText: t('common.delete'),
      onConfirm: async () => {
        const latestKeys = useConfigStore.getState().config?.apiKeys;
        const currentKeys = Array.isArray(latestKeys) ? latestKeys : [];
        const deleteIndex =
          currentKeys[index] === apiKeyToDelete
            ? index
            : currentKeys.findIndex((key) => key === apiKeyToDelete);

        if (deleteIndex < 0) {
          showNotification(t('notification.delete_failed'), 'error');
          return;
        }

        try {
          await apiKeysApi.delete(deleteIndex);
          const nextKeys = currentKeys.filter((_, idx) => idx !== deleteIndex);
          const nextLabels = removeCustomApiKeyLabel(apiKeyLabels, apiKeyToDelete);
          await syncLabelsToServer(nextLabels);
          setApiKeys(nextKeys);
          updateConfigValue('api-keys', nextKeys);
          clearCache('api-keys');
          showNotification(t('notification.api_key_deleted'), 'success');
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : '';
          showNotification(`${t('notification.delete_failed')}: ${message}`, 'error');
        }
      },
    });
  };

  const actionButtons = (
    <div style={{ display: 'flex', gap: 8 }}>
      <Button variant="secondary" size="sm" onClick={() => void loadApiKeys(true)} disabled={loading}>
        {t('common.refresh')}
      </Button>
      <Button size="sm" onClick={openAddModal} disabled={disableControls}>
        {t('api_keys.add_button')}
      </Button>
    </div>
  );

  return (
    <div className={`page-shell ${styles.container}`}>
      <div className="page-header">
        <div className="page-heading">
          <h1 className="page-title">{t('api_keys.title')}</h1>
          <p className="page-description">{t('api_keys.description')}</p>
        </div>
      </div>

      <Card title={t('api_keys.proxy_auth_title')} extra={actionButtons}>
        {error && <div className="error-box">{error}</div>}

        {loading ? (
          <div className="flex-center" style={{ padding: '24px 0' }}>
            <LoadingSpinner size={28} />
          </div>
        ) : apiKeys.length === 0 ? (
          <EmptyState
            title={t('api_keys.empty_title')}
            description={t('api_keys.empty_desc')}
            action={
              <Button onClick={openAddModal} disabled={disableControls}>
                {t('api_keys.add_button')}
              </Button>
            }
          />
        ) : (
          <div className="item-list">
            {apiKeys.map((key, index) => {
              const hasCustomLabel = !!getCustomApiKeyLabel(key, apiKeyLabels);
              return (
                <div key={index} className="item-row">
                  <div className="item-meta">
                    <div className="pill">#{index + 1}</div>
                    <div className="item-title">{getApiKeyDisplayLabel(key, apiKeyLabels)}</div>
                    <div className="item-subtitle">{maskApiKey(String(key || ''))}</div>
                    {!hasCustomLabel && (
                      <div className={styles.generatedHint}>{t('api_keys.generated_name_hint')}</div>
                    )}
                  </div>
                  <div className="item-actions">
                    <Button variant="secondary" size="sm" onClick={() => openEditModal(index)} disabled={disableControls}>
                      {t('common.edit')}
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => handleDelete(index)}
                      disabled={disableControls}
                    >
                      {t('common.delete')}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <Modal
          open={modalOpen}
          onClose={closeModal}
          title={editingIndex !== null ? t('api_keys.edit_modal_title') : t('api_keys.add_modal_title')}
          footer={
            <>
              <Button variant="secondary" onClick={closeModal} disabled={saving}>
                {t('common.cancel')}
              </Button>
              <Button onClick={handleSave} loading={saving}>
                {editingIndex !== null ? t('common.update') : t('common.add')}
              </Button>
            </>
          }
        >
          <Input
            label={t('api_keys.name_label')}
            placeholder={t('api_keys.name_placeholder')}
            value={labelValue}
            onChange={(e) => setLabelValue(e.target.value)}
            disabled={saving}
            hint={t('api_keys.name_hint')}
          />
          <Input
            label={editingIndex !== null ? t('api_keys.edit_modal_key_label') : t('api_keys.add_modal_key_label')}
            placeholder={editingIndex !== null ? t('api_keys.edit_modal_key_label') : t('api_keys.add_modal_key_placeholder')}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            disabled={saving}
          />
        </Modal>
      </Card>
    </div>
  );
}
