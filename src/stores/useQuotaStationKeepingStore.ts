import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { STORAGE_KEY_QUOTA_STATION_KEEPING } from '@/utils/constants';

interface QuotaStationKeepingState {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
}

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
