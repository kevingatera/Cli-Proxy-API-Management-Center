import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { DEFAULT_USAGE_FILTERS, type UsageFilters, UsageFilterOptions, UsageOutcomeFilter, UsageTimeWindowFilter } from '@/utils/usage';
import styles from '@/pages/UsagePage.module.scss';

export interface UsageFiltersCardProps {
  filters: UsageFilters;
  options: UsageFilterOptions;
  matchedRequests: number;
  totalRequests: number;
  onChange: (next: UsageFilters) => void;
  onReset: () => void;
  /** Optional map of auth_index hash -> friendly label (email/filename). */
  authIndexLabels?: Map<string, string>;
}

const countActiveFilters = (filters: UsageFilters): number => {
  let count = 0;
  if (filters.provider !== 'all') count += 1;
  if (filters.endpoint !== 'all') count += 1;
  if (filters.model !== 'all') count += 1;
  if (filters.authIndex !== 'all') count += 1;
  if (filters.outcome !== 'all') count += 1;
  if (filters.timeWindow !== 'all') count += 1;
  if (filters.query.trim()) count += 1;
  return count;
};

export function UsageFiltersCard({
  filters,
  options,
  matchedRequests,
  totalRequests,
  onChange,
  onReset,
  authIndexLabels
}: UsageFiltersCardProps) {
  const { t } = useTranslation();

  // Auto-expand when there are active filters so the user can see what is applied.
  const initiallyOpen = countActiveFilters(filters) > 0;
  const [open, setOpen] = useState(initiallyOpen);

  const activeCount = useMemo(() => countActiveFilters(filters), [filters]);

  const update = <K extends keyof UsageFilters>(key: K, value: UsageFilters[K]) => {
    onChange({ ...filters, [key]: value });
  };

  const handleReset = () => {
    onReset();
    setOpen(false);
  };

  const hasOptions =
    options.providers.length > 0 ||
    options.endpoints.length > 0 ||
    options.models.length > 0 ||
    options.authIndexes.length > 0;

  return (
    <Card
      title={
        <button
          type="button"
          className={styles.filterHeaderBtn}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className={styles.filterHeaderLabel}>
            {t('usage_stats.filters_title')}
          </span>
          <span className={styles.filterHeaderMeta}>
            <span className={styles.filterCountSummary}>
              {t('usage_stats.filters_summary', {
                matched: matchedRequests.toLocaleString(),
                total: totalRequests.toLocaleString()
              })}
            </span>
            {activeCount > 0 && (
              <span className={styles.filterActiveBadge}>{activeCount}</span>
            )}
            <span className={`${styles.filterChevron} ${open ? styles.filterChevronOpen : ''}`}>
              &#8250;
            </span>
          </span>
        </button>
      }
      extra={
        activeCount > 0 ? (
          <Button variant="secondary" size="sm" onClick={handleReset}>
            {t('usage_stats.filters_reset')}
          </Button>
        ) : null
      }
    >
      <div className={styles.filtersBody}>
        {/* Always-visible search row */}
        <div className={styles.filtersSearchRow}>
          <Input
            placeholder={t('usage_stats.filters_search_placeholder')}
            value={filters.query}
            onChange={(event) => update('query', event.target.value)}
          />
        </div>

        {/* Collapsible facet filters */}
        {open && hasOptions && (
          <div className={styles.filtersGrid}>
            {options.providers.length > 0 && (
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
            )}

            {options.endpoints.length > 0 && (
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
            )}

            {options.models.length > 0 && (
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
            )}

            {options.authIndexes.length > 0 && (
              <div className="form-group">
                <label>{t('usage_stats.filters_auth_index_label')}</label>
                <select
                  className={styles.select}
                  value={filters.authIndex}
                  onChange={(event) => update('authIndex', event.target.value)}
                >
                  <option value="all">{t('usage_stats.filters_any')}</option>
                  {options.authIndexes.map((authIndex) => {
                    const friendly = authIndexLabels?.get(authIndex);
                    return (
                      <option key={authIndex} value={authIndex}>
                        {friendly ? `${friendly} (${authIndex.slice(0, 6)})` : authIndex}
                      </option>
                    );
                  })}
                </select>
              </div>
            )}

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
        )}

        {open && !hasOptions && (
          <div className={styles.hint}>
            {t('usage_stats.no_filter_options', { defaultValue: 'No filterable fields in current data.' })}
          </div>
        )}
      </div>
    </Card>
  );
}

// Re-exported so callers can build an empty filter set without importing from utils.
export { DEFAULT_USAGE_FILTERS };
