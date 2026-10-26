import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, fetchCpaApiKeyOptions, type CpaApiKeyOptionsRequest } from '@/lib/api';
import type { CpaApiKeyOption } from '@/lib/types';

// 候选集与全局 Key 身份名册独立：范围内无用量不代表已选 Key 已被删除。
export function useScopedAPIKeyOptions(
  request: CpaApiKeyOptionsRequest | null,
  onOptions: (options: CpaApiKeyOption[]) => void,
  onAuthRequired?: () => void,
  onRangeBoundsConflict?: (error: unknown) => boolean,
) {
  const scopeKey = JSON.stringify(request);
  const controllerRef = useRef<AbortController | null>(null);
  const [state, setState] = useState<{ key: string; options: CpaApiKeyOption[]; status: 'loading' | 'ready' | 'error' }>({ key: '', options: [], status: 'loading' });
  const refresh = useCallback(async () => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    if (!request) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    // 同范围刷新保留已有候选；跨页面或时间范围不能沿用旧结果。
    setState((current) => ({ key: scopeKey, options: current.key === scopeKey ? current.options : [], status: 'loading' }));
    try {
      const response = await fetchCpaApiKeyOptions(controller.signal, request);
      if (controller.signal.aborted || controllerRef.current !== controller) return;
      const options = response.options ?? [];
      onOptions(options);
      setState({ key: scopeKey, options, status: 'ready' });
    } catch (error) {
      if (controller.signal.aborted || controllerRef.current !== controller) return;
      setState({ key: scopeKey, options: [], status: 'error' });
      if (error instanceof ApiError && error.status === 401) onAuthRequired?.();
      else onRangeBoundsConflict?.(error);
    }
  }, [request, scopeKey, onOptions, onAuthRequired, onRangeBoundsConflict]);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) void refresh(); });
    return () => { active = false; controllerRef.current?.abort(); controllerRef.current = null; };
  }, [refresh]);
  // 新页面首次渲染就隐藏旧候选项，不等待 effect 发出新请求。
  const current = state.key === scopeKey;
  return { options: request && current ? state.options : [], status: !request ? 'ready' : current ? state.status : 'loading', refresh };
}
