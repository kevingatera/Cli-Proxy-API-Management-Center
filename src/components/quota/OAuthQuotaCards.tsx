import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import {
  captureQuotaCacheGeneration,
  commitIfQuotaCacheCurrent,
  useNotificationStore,
  useQuotaStore,
  useThemeStore,
} from '@/stores';
import type { AuthFileItem } from '@/types';
import { getStatusFromError } from '@/utils/quota';
import { QuotaCard, type QuotaStatusState } from './QuotaCard';
import type { QuotaConfig } from './quotaConfigs';

interface Props<TState extends QuotaStatusState, TData> {
  config: QuotaConfig<TState, TData>;
  files: AuthFileItem[];
  disabled: boolean;
  refreshVersion: number;
}

export function OAuthQuotaCards<TState extends QuotaStatusState, TData>(
  props: Props<TState, TData>
) {
  return props.files
    .filter(props.config.filterFn)
    .map((file) => (
      <OAuthQuotaCard
        key={file.name}
        config={props.config}
        file={file}
        disabled={props.disabled}
        refreshVersion={props.refreshVersion}
      />
    ));
}

function OAuthQuotaCard<TState extends QuotaStatusState, TData>({
  config,
  file,
  disabled,
  refreshVersion,
}: Omit<Props<TState, TData>, 'files'> & { file: AuthFileItem }) {
  const { t } = useTranslation();
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);
  const generation = useQuotaStore((s) => s.cacheGeneration);
  const [quota, setQuota] = useState<TState>();
  const [resetting, setResetting] = useState(false);
  const pending = useRef<number | null>(null);
  const mounted = useRef(true);
  const showConfirmation = useNotificationStore((s) => s.showConfirmation);
  const showNotification = useNotificationStore((s) => s.showNotification);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const refresh = useCallback(async () => {
    if (disabled || file.disabled) return;
    const currentGeneration = captureQuotaCacheGeneration();
    if (pending.current === currentGeneration) return;
    pending.current = currentGeneration;
    setQuota(config.buildLoadingState());
    try {
      const data = await config.fetchQuota(file, t);
      commitIfQuotaCacheCurrent(currentGeneration, () => {
        if (mounted.current) setQuota(config.buildSuccessState(data));
      });
    } catch (error: unknown) {
      commitIfQuotaCacheCurrent(currentGeneration, () => {
        if (mounted.current)
          setQuota(
            config.buildErrorState(
              error instanceof Error ? error.message : String(error),
              getStatusFromError(error)
            )
          );
      });
    } finally {
      if (pending.current === currentGeneration) pending.current = null;
    }
  }, [config, disabled, file, t]);
  useEffect(() => {
    void refresh();
  }, [refresh, refreshVersion, generation]);
  const reset = () => {
    if (!config.resetQuota || disabled || resetting) return;
    showConfirmation({
      title: t('codex_quota.reset_confirm_title'),
      message: t('codex_quota.reset_confirm_message', { name: file.name }),
      confirmText: t('codex_quota.reset_confirm_button'),
      variant: 'primary',
      onConfirm: async () => {
        const currentGeneration = captureQuotaCacheGeneration();
        setResetting(true);
        try {
          const data = await config.resetQuota!(file, t);
          commitIfQuotaCacheCurrent(currentGeneration, () => {
            if (!mounted.current) return;
            setQuota(config.buildSuccessState(data));
            showNotification(t('codex_quota.reset_success', { name: file.name }), 'success');
          });
        } catch (error: unknown) {
          commitIfQuotaCacheCurrent(currentGeneration, () => {
            if (mounted.current)
              showNotification(
                t('codex_quota.reset_failed', {
                  name: file.name,
                  message: error instanceof Error ? error.message : String(error),
                }),
                'error'
              );
          });
        } finally {
          if (mounted.current) setResetting(false);
        }
      },
    });
  };
  return (
    <QuotaCard
      item={file}
      quota={quota}
      resolvedTheme={resolvedTheme}
      i18nPrefix={config.i18nPrefix}
      defaultType={config.type}
      cardClassName=""
      canRefresh={!disabled && !file.disabled && !resetting}
      onRefresh={() => void refresh()}
      renderQuotaItems={config.renderQuotaItems}
      resetQuotaAction={
        config.resetQuota && quota && config.canResetQuota?.(quota) ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={reset}
            disabled={disabled || resetting || quota.status === 'loading'}
            loading={resetting}
          >
            {t('codex_quota.reset_button')}
          </Button>
        ) : undefined
      }
    />
  );
}
