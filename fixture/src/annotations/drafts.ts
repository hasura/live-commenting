import { createContext, createElement, useCallback, useContext, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Body, SubmitOptions } from './types';

/** Page-local editing state. Never part of AnnotationDoc or a server event. */
export interface ComposerDraft {
  /** A fresh editing session also resets editor selection and undo history. */
  id: number;
  body: Body[];
  /** The manual choice; an inline bot mention independently requests delivery. */
  notifyBot: boolean;
  pending: boolean;
  error: string;
}

class DraftStore {
  private current: { key: string; draft: ComposerDraft } | undefined;
  private nextId = 0;
  private listeners = new Set<() => void>();

  get = (key: string) => this.current?.key === key ? this.current.draft : undefined;
  activeKey = () => this.current?.key;
  pending = () => !!this.current?.draft.pending;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private set(key: string, draft?: ComposerDraft) {
    this.current = draft ? { key, draft } : undefined;
    this.listeners.forEach(listener => listener());
  }
  begin(key: string, initial?: { body: Body[]; notifyBot?: boolean }) {
    if (this.pending()) return false;
    this.set(key, { id: ++this.nextId, body: initial?.body ?? [], notifyBot: !!initial?.notifyBot, pending: false, error: '' });
    return true;
  }
  update(key: string, body: Body[], options?: SubmitOptions) {
    const current = this.get(key);
    if (!current || current.pending) return;
    this.set(key, { ...current, body, notifyBot: options?.notifyBot ?? current.notifyBot, error: '' });
  }
  discard(key?: string) {
    if (key && this.current?.key !== key) return true;
    if (this.pending()) return false;
    if (this.current) this.set(this.current.key);
    return true;
  }
  async submit(key: string, body: Body[], save: () => void | Promise<void>) {
    const current = this.get(key);
    if (!current || current.pending) return;
    const posting = { ...current, body, pending: true, error: '' };
    this.set(key, posting);
    try {
      await save();
      if (this.get(key) === posting) this.set(key);
    } catch (error) {
      if (this.get(key) === posting) this.set(key, {
        ...posting, pending: false,
        error: error instanceof Error ? error.message : 'Saving failed. Your draft is still here.',
      });
      throw error;
    }
  }
}

const DraftContext = createContext<DraftStore | null>(null);
export function DraftsProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => new DraftStore());
  return createElement(DraftContext.Provider, { value: store }, children);
}
export function useDraftStore() {
  const store = useContext(DraftContext);
  if (!store) throw new Error('Drafts require an annotation instance.');
  return store;
}
export function useDraft(key: string) {
  const store = useDraftStore();
  const subscribe = useCallback((listener: () => void) => store.subscribe(listener), [store]);
  const snapshot = useCallback(() => store.get(key), [store, key]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
export function useDraftPending(key?: string) {
  const store = useDraftStore();
  const subscribe = useCallback((listener: () => void) => store.subscribe(listener), [store]);
  const snapshot = useCallback(() => key ? !!store.get(key)?.pending : store.pending(), [store, key]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
export function useActiveDraftKey() {
  const store = useDraftStore();
  return useSyncExternalStore(store.subscribe, store.activeKey, store.activeKey);
}
