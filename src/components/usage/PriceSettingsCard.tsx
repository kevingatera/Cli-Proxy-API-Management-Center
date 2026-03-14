import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useNotificationStore } from '@/stores';
import type { ModelPrice } from '@/utils/usage';
import {
  fetchBundledOpenRouterPrices,
  fetchOpenRouterLatestPrices,
  keepOnlyUsedModelPrices,
  mergeModelPricesForUsedModels,
} from '@/utils/modelPrices';
import styles from '@/pages/UsagePage.module.scss';

export interface PriceSettingsCardProps {
  modelNames: string[];
  modelPrices: Record<string, ModelPrice>;
  onPricesChange: (prices: Record<string, ModelPrice>) => void;
}

export function PriceSettingsCard({
  modelNames,
  modelPrices,
  onPricesChange,
}: PriceSettingsCardProps) {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();

  const [selectedModel, setSelectedModel] = useState('');
  const [promptPrice, setPromptPrice] = useState('');
  const [completionPrice, setCompletionPrice] = useState('');
  const [cachePrice, setCachePrice] = useState('');
  const [importingOpenRouter, setImportingOpenRouter] = useState(false);
  const [fetchingOpenRouter, setFetchingOpenRouter] = useState(false);

  const activeModelPrices = useMemo(
    () => keepOnlyUsedModelPrices(modelPrices, modelNames),
    [modelNames, modelPrices]
  );
  const hiddenPriceCount = Math.max(Object.keys(modelPrices).length - Object.keys(activeModelPrices).length, 0);

  const applyCatalogPrices = async (
    loader: () => Promise<Record<string, ModelPrice>>,
    mode: 'fetch' | 'import'
  ) => {
    if (!modelNames.length) {
      showNotification(t('usage_stats.model_price_no_usage_models'), 'warning');
      return;
    }

    const setLoading = mode === 'fetch' ? setFetchingOpenRouter : setImportingOpenRouter;
    const successKey =
      mode === 'fetch'
        ? 'usage_stats.fetch_openrouter_prices_success'
        : 'usage_stats.import_openrouter_prices_success';
    const failedKey =
      mode === 'fetch'
        ? 'usage_stats.fetch_openrouter_prices_failed'
        : 'usage_stats.import_openrouter_prices_failed';

    setLoading(true);
    try {
      const catalog = await loader();
      const { nextPrices, added, kept, missingModels } = mergeModelPricesForUsedModels(
        modelPrices,
        catalog,
        modelNames
      );
      onPricesChange(nextPrices);
      showNotification(
        t(successKey, {
          added,
          kept,
          missing: missingModels.length,
        }),
        'success'
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      showNotification(`${t(failedKey)}${message ? `: ${message}` : ''}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSavePrice = () => {
    if (!selectedModel) return;
    const prompt = parseFloat(promptPrice) || 0;
    const completion = parseFloat(completionPrice) || 0;
    const cache = cachePrice.trim() === '' ? prompt : parseFloat(cachePrice) || 0;
    onPricesChange({ ...activeModelPrices, [selectedModel]: { prompt, completion, cache } });
    setSelectedModel('');
    setPromptPrice('');
    setCompletionPrice('');
    setCachePrice('');
  };

  const handleDeletePrice = (model: string) => {
    const nextPrices = { ...activeModelPrices };
    delete nextPrices[model];
    onPricesChange(nextPrices);
  };

  const handleEditPrice = (model: string) => {
    const price = activeModelPrices[model];
    setSelectedModel(model);
    setPromptPrice(price?.prompt?.toString() || '');
    setCompletionPrice(price?.completion?.toString() || '');
    setCachePrice(price?.cache?.toString() || '');
  };

  const handleModelSelect = (value: string) => {
    setSelectedModel(value);
    const price = activeModelPrices[value];
    if (price) {
      setPromptPrice(price.prompt.toString());
      setCompletionPrice(price.completion.toString());
      setCachePrice(price.cache.toString());
      return;
    }
    setPromptPrice('');
    setCompletionPrice('');
    setCachePrice('');
  };

  return (
    <Card title={t('usage_stats.model_price_settings')}>
      <div className={styles.pricingSection}>
        <div className={styles.pricingActions}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void applyCatalogPrices(fetchOpenRouterLatestPrices, 'fetch')}
            loading={fetchingOpenRouter}
            disabled={fetchingOpenRouter || importingOpenRouter}
          >
            {t('usage_stats.fetch_openrouter_prices')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void applyCatalogPrices(fetchBundledOpenRouterPrices, 'import')}
            loading={importingOpenRouter}
            disabled={importingOpenRouter || fetchingOpenRouter}
          >
            {t('usage_stats.import_openrouter_prices')}
          </Button>
        </div>

        <div className={styles.pricingHintBlock}>
          <div className={styles.pricingHint}>{t('usage_stats.pricing_scope_hint')}</div>
          {hiddenPriceCount > 0 && (
            <div className={styles.pricingHint}>{t('usage_stats.pricing_hidden_unused', { count: hiddenPriceCount })}</div>
          )}
        </div>

        <div className={styles.priceForm}>
          <div className={styles.formRow}>
            <div className={styles.formField}>
              <label>{t('usage_stats.model_name')}</label>
              <select
                value={selectedModel}
                onChange={(e) => handleModelSelect(e.target.value)}
                className={styles.select}
              >
                <option value="">{t('usage_stats.model_price_select_placeholder')}</option>
                {modelNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.formField}>
              <label>{t('usage_stats.model_price_prompt')} ($/1M)</label>
              <Input
                type="number"
                value={promptPrice}
                onChange={(e) => setPromptPrice(e.target.value)}
                placeholder="0.00"
                step="0.0001"
              />
            </div>
            <div className={styles.formField}>
              <label>{t('usage_stats.model_price_completion')} ($/1M)</label>
              <Input
                type="number"
                value={completionPrice}
                onChange={(e) => setCompletionPrice(e.target.value)}
                placeholder="0.00"
                step="0.0001"
              />
            </div>
            <div className={styles.formField}>
              <label>{t('usage_stats.model_price_cache')} ($/1M)</label>
              <Input
                type="number"
                value={cachePrice}
                onChange={(e) => setCachePrice(e.target.value)}
                placeholder="0.00"
                step="0.0001"
              />
            </div>
            <Button variant="primary" onClick={handleSavePrice} disabled={!selectedModel}>
              {t('common.save')}
            </Button>
          </div>
        </div>

        <div className={styles.pricesList}>
          <h4 className={styles.pricesTitle}>{t('usage_stats.saved_prices')}</h4>
          {Object.keys(activeModelPrices).length > 0 ? (
            <div className={styles.pricesGrid}>
              {(Object.entries(activeModelPrices) as Array<[string, ModelPrice]>).map(([model, price]) => (
                <div key={model} className={styles.priceItem}>
                  <div className={styles.priceInfo}>
                    <span className={styles.priceModel}>{model}</span>
                    <div className={styles.priceMeta}>
                      <span>{t('usage_stats.model_price_prompt')}: ${price.prompt.toFixed(4)}/1M</span>
                      <span>{t('usage_stats.model_price_completion')}: ${price.completion.toFixed(4)}/1M</span>
                      <span>{t('usage_stats.model_price_cache')}: ${price.cache.toFixed(4)}/1M</span>
                    </div>
                  </div>
                  <div className={styles.priceActions}>
                    <Button variant="secondary" size="sm" onClick={() => handleEditPrice(model)}>
                      {t('common.edit')}
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => handleDeletePrice(model)}>
                      {t('common.delete')}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.hint}>{t('usage_stats.model_price_empty')}</div>
          )}
        </div>
      </div>
    </Card>
  );
}
