import { createContext, useContext } from 'react';
import type { MentionDirectory } from './types';

/** Host owns authorization, network and freshness. Library consumes only data. */
export interface MentionSource {
  directory: MentionDirectory | null;
  refresh?: () => void;
  error?: string;
}
export const MentionContext = createContext<MentionSource>({ directory: null });
export const useMentions = () => useContext(MentionContext);
