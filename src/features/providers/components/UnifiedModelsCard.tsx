import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { apiClient } from '@/services/api/client';
import styles from './UnifiedModelsCard.module.scss';

interface Route {
  provider: string;
  upstream_model: string;
  plan: string;
  eligible: boolean;
  quota_known: boolean;
  remaining_fraction?: number;
  model_tokens_per_minute: number;
  reason: string;
}
interface Offering {
  enabled: boolean;
  bare_names: boolean;
  expose_legacy: boolean;
  models: { id: string; routes: Route[] }[];
}

export function UnifiedModelsCard({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation();
  const [offering, setOffering] = useState<Offering | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      setOffering(await apiClient.getV8<Offering>('/routing/unified-models'));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('notification.refresh_failed'));
    }
  }, [t]);
  useEffect(() => {
    if (!disabled) void load();
  }, [disabled, load]);
  const update = async (key: 'enabled' | 'bare_names' | 'expose_legacy', value: boolean) => {
    setBusy(true);
    try {
      await apiClient.patchV8('/routing/unified-models', { [key]: value });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('notification.refresh_failed'));
    } finally {
      setBusy(false);
    }
  };
  if (!offering) return error ? <Card title={t('unified_models.title')}>{error}</Card> : null;
  return (
    <Card
      title={t('unified_models.title')}
      extra={
        <Button variant="secondary" size="sm" disabled={disabled || busy} onClick={load}>
          {t('common.refresh')}
        </Button>
      }
    >
      <p>{t('unified_models.description')}</p>
      <div className={styles.switches}>
        {(['enabled', 'bare_names', 'expose_legacy'] as const).map((key) => (
          <ToggleSwitch
            key={key}
            label={t(`unified_models.${key}`)}
            checked={offering[key]}
            disabled={disabled || busy || offering.models.length === 0}
            onChange={(value) => void update(key, value)}
          />
        ))}
      </div>
      <p className={styles.example}>
        {t('unified_models.example')}:{' '}
        <code>{offering.bare_names ? 'kimi-k3' : 'cliproxy/kimi-k3'}</code>
      </p>
      {error && <p role="alert">{error}</p>}
      <details>
        <summary>{t('unified_models.models', { count: offering.models.length })}</summary>
        <div className={styles.models}>
          {offering.models.map((model) => (
            <div className={styles.model} key={model.id}>
              <strong>{model.id}</strong>
              {model.routes.map((route, index) => (
                <div className={styles.route} key={`${route.provider}-${index}`}>
                  <span>
                    {route.provider} ·{' '}
                    {t(`unified_models.${route.plan === 'included' ? 'included' : 'metered'}`)}
                  </span>
                  <span>
                    {!route.eligible
                      ? t('unified_models.unavailable')
                      : route.quota_known && route.remaining_fraction !== undefined
                        ? t('unified_models.remaining', {
                            percent: Math.round(route.remaining_fraction * 100),
                          })
                        : t('unified_models.unknown')}
                  </span>
                  <code>{route.upstream_model}</code>
                  {route.model_tokens_per_minute > 0 && (
                    <span>
                      {t('unified_models.burn', {
                        tokens: Math.round(route.model_tokens_per_minute),
                      })}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </details>
    </Card>
  );
}
