import { useCallback, useMemo } from 'react';
import { collectUsageDetails, extractTotalTokens, calculateCost, type ModelPrice } from '@/utils/usage';
import type { UsagePayload } from './useUsageData';

export interface SparklineData {
  labels: string[];
  datasets: [
    {
      data: number[];
      borderColor: string;
      backgroundColor: string;
      fill: boolean;
      tension: number;
      pointRadius: number;
      borderWidth: number;
    }
  ];
}

export interface SparklineBundle {
  data: SparklineData;
}

export interface UseSparklinesOptions {
  usage: UsagePayload | null;
  loading: boolean;
  modelPrices?: Record<string, ModelPrice>;
}

export interface UseSparklinesReturn {
  requestsSparkline: SparklineBundle | null;
  tokensSparkline: SparklineBundle | null;
  rpmSparkline: SparklineBundle | null;
  tpmSparkline: SparklineBundle | null;
  costSparkline: SparklineBundle | null;
}

type SeriesMetric = 'requests' | 'tokens' | 'cost';

export function useSparklines({ usage, loading, modelPrices }: UseSparklinesOptions): UseSparklinesReturn {
  const buildLastHourSeries = useCallback(
    (metric: SeriesMetric): { labels: string[]; data: number[] } => {
      if (!usage) return { labels: [], data: [] };
      const details = collectUsageDetails(usage);
      if (!details.length) return { labels: [], data: [] };

      const windowMinutes = 60;
      const now = Date.now();
      const windowStart = now - windowMinutes * 60 * 1000;
      const buckets = new Array(windowMinutes).fill(0);

      const prices = modelPrices && Object.keys(modelPrices).length > 0 ? modelPrices : null;

      details.forEach((detail) => {
        const timestamp = Date.parse(detail.timestamp);
        if (Number.isNaN(timestamp) || timestamp < windowStart) {
          return;
        }
        const minuteIndex = Math.min(
          windowMinutes - 1,
          Math.floor((timestamp - windowStart) / 60000)
        );
        let increment = 0;
        if (metric === 'tokens') {
          increment = extractTotalTokens(detail);
        } else if (metric === 'cost') {
          // Cost is only meaningful when we have prices; otherwise treat as 0
          // so the sparkline renders an honest flat line instead of mirroring
          // the tokens trend.
          increment = prices ? calculateCost(detail, prices) : 0;
        } else {
          increment = 1;
        }
        buckets[minuteIndex] += increment;
      });

      const labels = buckets.map((_, idx) => {
        const date = new Date(windowStart + (idx + 1) * 60000);
        const h = date.getHours().toString().padStart(2, '0');
        const m = date.getMinutes().toString().padStart(2, '0');
        return `${h}:${m}`;
      });

      return { labels, data: buckets };
    },
    [usage, modelPrices]
  );

  const buildSparkline = useCallback(
    (
      series: { labels: string[]; data: number[] },
      color: string,
      backgroundColor: string
    ): SparklineBundle | null => {
      if (loading || !series?.data?.length) {
        return null;
      }
      const sliceStart = Math.max(series.data.length - 60, 0);
      const labels = series.labels.slice(sliceStart);
      const points = series.data.slice(sliceStart);
      return {
        data: {
          labels,
          datasets: [
            {
              data: points,
              borderColor: color,
              backgroundColor,
              fill: true,
              tension: 0.45,
              pointRadius: 0,
              borderWidth: 2
            }
          ]
        }
      };
    },
    [loading]
  );

  const requestsSparkline = useMemo(
    () => buildSparkline(buildLastHourSeries('requests'), '#3b82f6', 'rgba(59, 130, 246, 0.18)'),
    [buildLastHourSeries, buildSparkline]
  );

  const tokensSparkline = useMemo(
    () => buildSparkline(buildLastHourSeries('tokens'), '#8b5cf6', 'rgba(139, 92, 246, 0.18)'),
    [buildLastHourSeries, buildSparkline]
  );

  const rpmSparkline = useMemo(
    () => buildSparkline(buildLastHourSeries('requests'), '#22c55e', 'rgba(34, 197, 94, 0.18)'),
    [buildLastHourSeries, buildSparkline]
  );

  const tpmSparkline = useMemo(
    () => buildSparkline(buildLastHourSeries('tokens'), '#f97316', 'rgba(249, 115, 22, 0.18)'),
    [buildLastHourSeries, buildSparkline]
  );

  const costSparkline = useMemo(
    () => buildSparkline(buildLastHourSeries('cost'), '#f59e0b', 'rgba(245, 158, 11, 0.18)'),
    [buildLastHourSeries, buildSparkline]
  );

  return {
    requestsSparkline,
    tokensSparkline,
    rpmSparkline,
    tpmSparkline,
    costSparkline
  };
}
