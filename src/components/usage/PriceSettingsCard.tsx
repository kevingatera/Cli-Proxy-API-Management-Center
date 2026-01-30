import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useNotificationStore } from '@/stores';
import type { ModelPrice } from '@/utils/usage';
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

  const normalizeModelPricesPayload = (payload: unknown): Record<string, ModelPrice> => {
    const candidate: any =
      payload &&
      typeof payload === 'object' &&
      (payload as any).prices &&
      typeof (payload as any).prices === 'object'
        ? (payload as any).prices
        : payload;

    if (!candidate || typeof candidate !== 'object') {
      throw new Error('invalid payload');
    }

    const normalized: Record<string, ModelPrice> = {};
    for (const [model, price] of Object.entries(candidate as Record<string, any>)) {
      if (!model || !price || typeof price !== 'object') continue;
      const prompt = Number((price as any).prompt);
      const completion = Number((price as any).completion);
      const cache = (price as any).cache === undefined ? prompt : Number((price as any).cache);
      normalized[model] = {
        prompt: Number.isFinite(prompt) && prompt >= 0 ? prompt : 0,
        completion: Number.isFinite(completion) && completion >= 0 ? completion : 0,
        cache:
          Number.isFinite(cache) && cache >= 0
            ? cache
            : Number.isFinite(prompt) && prompt >= 0
              ? prompt
              : 0,
      };
    }
    return normalized;
  };

  const mergeAsDefaults = (defaults: Record<string, ModelPrice>) => {
    const existingKeys = new Set(Object.keys(modelPrices));
    let added = 0;
    let kept = 0;
    for (const key of Object.keys(defaults)) {
      if (existingKeys.has(key)) kept += 1;
      else added += 1;
    }
    onPricesChange({ ...defaults, ...modelPrices });
    return { added, kept };
  };

  const addShortModelAliases = (prices: Record<string, ModelPrice>): Record<string, ModelPrice> => {
    const merged: Record<string, ModelPrice> = { ...prices };
    for (const [id, price] of Object.entries(prices)) {
      const parts = id.split('/').filter(Boolean);
      if (parts.length < 2) continue;
      const short = parts[parts.length - 1];
      if (!short || merged[short]) continue;
      merged[short] = price;
    }
    return merged;
  };

  const fetchOpenRouterLatestPrices = async (): Promise<Record<string, ModelPrice>> => {
    const res = await fetch('https://openrouter.ai/api/v1/models', { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const payload: any = await res.json();
    const models: any[] = Array.isArray(payload?.data) ? payload.data : [];
    const prices: Record<string, ModelPrice> = {};

    for (const model of models) {
      const id = typeof model?.id === 'string' ? model.id : '';
      const pricing = model?.pricing && typeof model.pricing === 'object' ? model.pricing : null;
      if (!id || !pricing) continue;

      const promptPerToken = Number((pricing as any).prompt);
      const completionPerToken = Number((pricing as any).completion);

      const prompt = Number.isFinite(promptPerToken) ? Math.max(promptPerToken, 0) * 1_000_000 : 0;
      const completion = Number.isFinite(completionPerToken)
        ? Math.max(completionPerToken, 0) * 1_000_000
        : 0;

      prices[id] = {
        prompt,
        completion,
        cache: prompt,
      };
    }

    return addShortModelAliases(prices);
  };

  const handleImportOpenRouterPrices = async () => {
    setImportingOpenRouter(true);
    try {
      const res = await fetch('/model-prices/openrouter.json', { cache: 'force-cache' });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const payload = await res.json();
      const normalized = normalizeModelPricesPayload(payload);
      const { added, kept } = mergeAsDefaults(addShortModelAliases(normalized));
      showNotification(
        t('usage_stats.import_openrouter_prices_success', { added, kept }),
        'success'
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      showNotification(
        `${t('usage_stats.import_openrouter_prices_failed')}${message ? `: ${message}` : ''}`,
        'error'
      );
    } finally {
      setImportingOpenRouter(false);
    }
  };

  const handleFetchOpenRouterLatestPrices = async () => {
    setFetchingOpenRouter(true);
    try {
      const prices = await fetchOpenRouterLatestPrices();
      const { added, kept } = mergeAsDefaults(prices);
      showNotification(
        t('usage_stats.fetch_openrouter_prices_success', { added, kept }),
        'success'
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      showNotification(
        `${t('usage_stats.fetch_openrouter_prices_failed')}${message ? `: ${message}` : ''}`,
        'error'
      );
    } finally {
      setFetchingOpenRouter(false);
    }
  };

  const handleSavePrice = () => {
    if (!selectedModel) return;
    const prompt = parseFloat(promptPrice) || 0;
    const completion = parseFloat(completionPrice) || 0;
    const cache = cachePrice.trim() === '' ? prompt : parseFloat(cachePrice) || 0;
    const newPrices = { ...modelPrices, [selectedModel]: { prompt, completion, cache } };
    onPricesChange(newPrices);
    setSelectedModel('');
    setPromptPrice('');
    setCompletionPrice('');
    setCachePrice('');
  };

  const handleDeletePrice = (model: string) => {
    const newPrices = { ...modelPrices };
    delete newPrices[model];
    onPricesChange(newPrices);
  };

  const handleEditPrice = (model: string) => {
    const price = modelPrices[model];
    setSelectedModel(model);
    setPromptPrice(price?.prompt?.toString() || '');
    setCompletionPrice(price?.completion?.toString() || '');
    setCachePrice(price?.cache?.toString() || '');
  };

  const handleModelSelect = (value: string) => {
    setSelectedModel(value);
    const price = modelPrices[value];
    if (price) {
      setPromptPrice(price.prompt.toString());
      setCompletionPrice(price.completion.toString());
      setCachePrice(price.cache.toString());
    } else {
      setPromptPrice('');
      setCompletionPrice('');
      setCachePrice('');
    }
  };

  return (
    <Card title={t('usage_stats.model_price_settings')}>
      <div className={styles.pricingSection}>
        <div className={styles.pricingActions}>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleFetchOpenRouterLatestPrices}
            loading={fetchingOpenRouter}
            disabled={fetchingOpenRouter || importingOpenRouter}
          >
            {t('usage_stats.fetch_openrouter_prices')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleImportOpenRouterPrices}
            loading={importingOpenRouter}
            disabled={importingOpenRouter || fetchingOpenRouter}
          >
            {t('usage_stats.import_openrouter_prices')}
          </Button>
        </div>

        {/* Price Form */}
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

        {/* Saved Prices List */}
        <div className={styles.pricesList}>
          <h4 className={styles.pricesTitle}>{t('usage_stats.saved_prices')}</h4>
          {Object.keys(modelPrices).length > 0 ? (
            <div className={styles.pricesGrid}>
              {Object.entries(modelPrices).map(([model, price]) => (
                <div key={model} className={styles.priceItem}>
                  <div className={styles.priceInfo}>
                    <span className={styles.priceModel}>{model}</span>
                    <div className={styles.priceMeta}>
                      <span>
                        {t('usage_stats.model_price_prompt')}: ${price.prompt.toFixed(4)}/1M
                      </span>
                      <span>
                        {t('usage_stats.model_price_completion')}: ${price.completion.toFixed(4)}/1M
                      </span>
                      <span>
                        {t('usage_stats.model_price_cache')}: ${price.cache.toFixed(4)}/1M
                      </span>
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
