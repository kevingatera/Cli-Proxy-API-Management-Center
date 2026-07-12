import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useServerPreferenceSync } from '@/hooks/useServerPreferenceSync';
import { useThemeStore } from '@/stores';
import {
  StatCards,
  UsageChart,
  ChartLineSelector,
  UsageFiltersCard,
  ApiDetailsCard,
  ModelStatsCard,
  PriceSettingsCard,
  useUsageData,
  useSparklines,
  useChartData,
  useAuthIndexLabels
} from '@/components/usage';
import {
  DEFAULT_USAGE_FILTERS,
  filterUsageData,
  getApiStats,
  getModelNamesFromUsage,
  getModelStats,
  getUsageFilterOptions,
  type UsageFilters
} from '@/utils/usage';
import styles from './UsagePage.module.scss';

const USAGE_VIEW_STATE_KEY = 'cliproxy-usage-view-v1';
type ChartPeriod = 'hour' | 'day';

const loadUsageViewState = (): {
  chartLines: string[];
  requestsPeriod: ChartPeriod;
  tokensPeriod: ChartPeriod;
} => {
  try {
    if (typeof localStorage === 'undefined') {
      return { chartLines: ['all'], requestsPeriod: 'day', tokensPeriod: 'day' };
    }
    const raw = localStorage.getItem(USAGE_VIEW_STATE_KEY);
    if (!raw) {
      return { chartLines: ['all'], requestsPeriod: 'day', tokensPeriod: 'day' };
    }
    const parsed = JSON.parse(raw) as {
      chartLines?: string[];
      requestsPeriod?: ChartPeriod;
      tokensPeriod?: ChartPeriod;
    };
    return {
      chartLines: Array.isArray(parsed.chartLines) && parsed.chartLines.length ? parsed.chartLines : ['all'],
      requestsPeriod: parsed.requestsPeriod === 'hour' ? 'hour' : 'day',
      tokensPeriod: parsed.tokensPeriod === 'hour' ? 'hour' : 'day',
    };
  } catch {
    return { chartLines: ['all'], requestsPeriod: 'day', tokensPeriod: 'day' };
  }
};

const clearUsageViewState = () => {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(USAGE_VIEW_STATE_KEY);
  } catch {
    // ignore cleanup failures
  }
};

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

export function UsagePage() {
  const { t } = useTranslation();
  const isMobile = useMediaQuery('(max-width: 768px)');
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const isDark = resolvedTheme === 'dark';
  const savedViewState = useMemo(() => loadUsageViewState(), []);

  // Data hook
  const {
    usage,
    loading,
    error,
    modelPrices,
    setModelPrices,
    loadUsage,
    handleExport,
    handleImport,
    handleImportChange,
    importInputRef,
    exporting,
    importing
  } = useUsageData();

  useHeaderRefresh(loadUsage);

  // Auth index -> friendly label map (email/filename) for the Auth Index filter.
  // Built from the unfiltered payload so labels exist even for credentials
  // that the current filter has hidden.
  const { labelsByIndex: authIndexLabels } = useAuthIndexLabels(usage);

  // Chart lines state
  const [chartLines, setChartLines] = useState<string[]>(savedViewState.chartLines);
  const MAX_CHART_LINES = 9;
  const [filters, setFilters] = useState<UsageFilters>({ ...DEFAULT_USAGE_FILTERS });

  const filteredUsage = useMemo(() => filterUsageData(usage, filters), [usage, filters]);
  const usageForDisplay = filteredUsage ?? usage;
  const filterOptions = useMemo(() => getUsageFilterOptions(usage), [usage]);

  // Sparklines hook
  const {
    requestsSparkline,
    tokensSparkline,
    rpmSparkline,
    tpmSparkline,
    costSparkline
  } = useSparklines({ usage: usageForDisplay, loading, modelPrices });

  // Chart data hook
  const {
    requestsPeriod,
    setRequestsPeriod,
    tokensPeriod,
    setTokensPeriod,
    requestsChartData,
    tokensChartData,
    requestsChartOptions,
    tokensChartOptions
  } = useChartData({ usage: usageForDisplay, chartLines, isDark, isMobile });

  const applyViewState = useCallback((value: {
    chartLines?: string[];
    requestsPeriod?: ChartPeriod;
    tokensPeriod?: ChartPeriod;
  }) => {
    if (Array.isArray(value.chartLines) && value.chartLines.length) {
      setChartLines(value.chartLines);
    }
    setRequestsPeriod(value.requestsPeriod === 'hour' ? 'hour' : 'day');
    setTokensPeriod(value.tokensPeriod === 'hour' ? 'hour' : 'day');
  }, [setRequestsPeriod, setTokensPeriod]);

  useServerPreferenceSync(
    'usage-view',
    { chartLines, requestsPeriod, tokensPeriod },
    applyViewState,
    { readLegacy: loadUsageViewState, clearLegacy: clearUsageViewState }
  );

  // Derived data
  const modelNames = useMemo(() => getModelNamesFromUsage(usageForDisplay), [usageForDisplay]);
  const allModelNames = useMemo(() => getModelNamesFromUsage(usage), [usage]);
  const apiStats = useMemo(() => getApiStats(usageForDisplay, modelPrices), [usageForDisplay, modelPrices]);
  const modelStats = useMemo(() => getModelStats(usageForDisplay, modelPrices), [usageForDisplay, modelPrices]);
  const hasPrices = Object.keys(modelPrices).length > 0;

  return (
    <div className={`page-shell ${styles.container}`}>
      {loading && !usage && (
        <div className={styles.loadingOverlay} aria-busy="true">
          <div className={styles.loadingOverlayContent}>
            <LoadingSpinner size={28} className={styles.loadingOverlaySpinner} />
            <span className={styles.loadingOverlayText}>{t('common.loading')}</span>
          </div>
        </div>
      )}

      <div className={`page-header ${styles.header}`}>
        <div className="page-heading">
          <h1 className="page-title">{t('usage_stats.title')}</h1>
          <p className="page-description">{t('usage_stats.description')}</p>
        </div>
        <div className={`page-actions ${styles.headerActions}`}>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleExport}
            loading={exporting}
            disabled={loading || importing}
          >
            {t('usage_stats.export')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleImport}
            loading={importing}
            disabled={loading || exporting}
          >
            {t('usage_stats.import')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={loadUsage}
            disabled={loading || exporting || importing}
          >
            {loading ? t('common.loading') : t('usage_stats.refresh')}
          </Button>
          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={handleImportChange}
          />
        </div>
      </div>

      {error && <div className={styles.errorBox}>{error}</div>}

      <UsageFiltersCard
        filters={filters}
        options={filterOptions}
        matchedRequests={usageForDisplay?.total_requests ?? 0}
        totalRequests={usage?.total_requests ?? 0}
        onChange={setFilters}
        onReset={() => setFilters({ ...DEFAULT_USAGE_FILTERS })}
        authIndexLabels={authIndexLabels}
      />

      {/* Stats Overview Cards */}
      <StatCards
        usage={usageForDisplay}
        loading={loading}
        modelPrices={modelPrices}
        sparklines={{
          requests: requestsSparkline,
          tokens: tokensSparkline,
          rpm: rpmSparkline,
          tpm: tpmSparkline,
          cost: costSparkline
        }}
      />

      {/* Chart Line Selection */}
      <ChartLineSelector
        chartLines={chartLines}
        modelNames={modelNames}
        maxLines={MAX_CHART_LINES}
        onChange={setChartLines}
      />

      {/* Charts Grid */}
      <div className={styles.chartsGrid}>
        <UsageChart
          title={t('usage_stats.requests_trend')}
          period={requestsPeriod}
          onPeriodChange={setRequestsPeriod}
          chartData={requestsChartData}
          chartOptions={requestsChartOptions}
          loading={loading}
          isMobile={isMobile}
          emptyText={t('usage_stats.no_data')}
        />
        <UsageChart
          title={t('usage_stats.tokens_trend')}
          period={tokensPeriod}
          onPeriodChange={setTokensPeriod}
          chartData={tokensChartData}
          chartOptions={tokensChartOptions}
          loading={loading}
          isMobile={isMobile}
          emptyText={t('usage_stats.no_data')}
        />
      </div>

      {/* Details Grid */}
      <div className={styles.detailsGrid}>
        <ApiDetailsCard apiStats={apiStats} loading={loading} hasPrices={hasPrices} />
        <ModelStatsCard modelStats={modelStats} loading={loading} hasPrices={hasPrices} />
      </div>

      {/* Price Settings */}
      <PriceSettingsCard
        modelNames={allModelNames}
        modelPrices={modelPrices}
        onPricesChange={setModelPrices}
      />
    </div>
  );
}
