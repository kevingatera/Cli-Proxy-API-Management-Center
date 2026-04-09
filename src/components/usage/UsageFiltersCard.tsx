import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import type { UsageFilters, UsageFilterOptions, UsageOutcomeFilter, UsageTimeWindowFilter } from '@/utils/usage';
import styles from '@/pages/UsagePage.module.scss';

export interface UsageFiltersCardProps {
  filters: UsageFilters;
  options: UsageFilterOptions;
  matchedRequests: number;
  totalRequests: number;
  onChange: (next: UsageFilters) => void;
  onReset: () => void;
}

export function UsageFiltersCard({
  filters,
  options,
  matchedRequests,
  totalRequests,
  onChange,
  onReset
}: UsageFiltersCardProps) {
  const { t } = useTranslation();

  const update = <K extends keyof UsageFilters>(key: K, value: UsageFilters[K]) => {
    onChange({ ...filters, [key]: value });
  };

  return (
    <Card
      title={t('usage_stats.filters_title')}
      extra={
        <div className={styles.filtersActions}>
          <span className={styles.filtersSummary}>
            {t('usage_stats.filters_summary', {
              matched: matchedRequests.toLocaleString(),
              total: totalRequests.toLocaleString()
            })}
          </span>
          <Button variant="secondary" size="sm" onClick={onReset}>
            {t('usage_stats.filters_reset')}
          </Button>
        </div>
      }
    >
      <div className={styles.filtersGrid}>
        <Input
          label={t('usage_stats.filters_search_label')}
          placeholder={t('usage_stats.filters_search_placeholder')}
          value={filters.query}
          onChange={(event) => update('query', event.target.value)}
        />

        <div className="form-group">
          <label>{t('usage_stats.filters_provider_label')}</label>
          <select
            className={styles.select}
            value={filters.provider}
            onChange={(event) => update('provider', event.target.value)}
          >
            <option value="all">{t('usage_stats.filters_any')}</option>
            {options.providers.map((provider) => (
              <option key={provider} value={provider}>
                {provider}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label>{t('usage_stats.filters_endpoint_label')}</label>
          <select
            className={styles.select}
            value={filters.endpoint}
            onChange={(event) => update('endpoint', event.target.value)}
          >
            <option value="all">{t('usage_stats.filters_any')}</option>
            {options.endpoints.map((endpoint) => (
              <option key={endpoint} value={endpoint}>
                {endpoint}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label>{t('usage_stats.filters_model_label')}</label>
          <select
            className={styles.select}
            value={filters.model}
            onChange={(event) => update('model', event.target.value)}
          >
            <option value="all">{t('usage_stats.filters_any')}</option>
            {options.models.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label>{t('usage_stats.filters_auth_index_label')}</label>
          <select
            className={styles.select}
            value={filters.authIndex}
            onChange={(event) => update('authIndex', event.target.value)}
          >
            <option value="all">{t('usage_stats.filters_any')}</option>
            {options.authIndexes.map((authIndex) => (
              <option key={authIndex} value={authIndex}>
                {authIndex}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label>{t('usage_stats.filters_outcome_label')}</label>
          <select
            className={styles.select}
            value={filters.outcome}
            onChange={(event) => update('outcome', event.target.value as UsageOutcomeFilter)}
          >
            <option value="all">{t('usage_stats.filters_outcome_all')}</option>
            <option value="success">{t('usage_stats.filters_outcome_success')}</option>
            <option value="failure">{t('usage_stats.filters_outcome_failure')}</option>
          </select>
        </div>

        <div className="form-group">
          <label>{t('usage_stats.filters_time_label')}</label>
          <select
            className={styles.select}
            value={filters.timeWindow}
            onChange={(event) => update('timeWindow', event.target.value as UsageTimeWindowFilter)}
          >
            <option value="all">{t('usage_stats.filters_time_all')}</option>
            <option value="1h">{t('usage_stats.filters_time_1h')}</option>
            <option value="24h">{t('usage_stats.filters_time_24h')}</option>
            <option value="7d">{t('usage_stats.filters_time_7d')}</option>
            <option value="30d">{t('usage_stats.filters_time_30d')}</option>
          </select>
        </div>
      </div>
    </Card>
  );
}
