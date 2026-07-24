import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { STORAGE_KEY_QUOTA_STATION_KEEPING } from '@/utils/constants';

interface QuotaStationKeepingState {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
}

/**
 * Station keeping for the Quota page.
 *
 * When enabled, the Quota page auto-refreshes quota telemetry in the
 * background so weekly resets are caught without operator action. The
 * state is persisted to localStorage so the preference survives page
 * reloads and route switches.
 */
export const useQuotaStationKeepingStore = create<QuotaStationKeepingState>()(
  persist(
    (set) => ({
      enabled: true,
      setEnabled: (enabled) => set({ enabled })
    }),
    {
      name: STORAGE_KEY_QUOTA_STATION_KEEPING
    }
  )
);
