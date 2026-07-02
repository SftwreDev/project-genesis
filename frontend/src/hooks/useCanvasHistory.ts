import { useCallback, useRef, useState } from 'react';
import type { Edge, Node } from '@xyflow/react';
import type { CommandNodeData, WorkflowGroup } from '../types';

export type CanvasSnapshot = {
  nodes: Node<CommandNodeData>[];
  edges: Edge[];
  workflowGroups: WorkflowGroup[];
};

const MAX_HISTORY = 50;

function cloneSnapshot(snapshot: CanvasSnapshot): CanvasSnapshot {
  return structuredClone(snapshot);
}

export function useCanvasHistory() {
  const pastRef = useRef<CanvasSnapshot[]>([]);
  const futureRef = useRef<CanvasSnapshot[]>([]);
  const isApplyingRef = useRef(false);
  const dragHistoryRecordedRef = useRef(false);
  const [flags, setFlags] = useState({ canUndo: false, canRedo: false });

  const syncFlags = useCallback(() => {
    setFlags({
      canUndo: pastRef.current.length > 0,
      canRedo: futureRef.current.length > 0,
    });
  }, []);

  const record = useCallback(
    (snapshot: CanvasSnapshot) => {
      if (isApplyingRef.current) return;
      pastRef.current = [...pastRef.current.slice(-(MAX_HISTORY - 1)), cloneSnapshot(snapshot)];
      futureRef.current = [];
      syncFlags();
    },
    [syncFlags],
  );

  const undo = useCallback(
    (current: CanvasSnapshot): CanvasSnapshot | null => {
      if (pastRef.current.length === 0) return null;
      isApplyingRef.current = true;
      futureRef.current = [cloneSnapshot(current), ...futureRef.current];
      const previous = pastRef.current.pop()!;
      syncFlags();
      queueMicrotask(() => {
        isApplyingRef.current = false;
      });
      return cloneSnapshot(previous);
    },
    [syncFlags],
  );

  const redo = useCallback(
    (current: CanvasSnapshot): CanvasSnapshot | null => {
      if (futureRef.current.length === 0) return null;
      isApplyingRef.current = true;
      pastRef.current.push(cloneSnapshot(current));
      const next = futureRef.current.shift()!;
      syncFlags();
      queueMicrotask(() => {
        isApplyingRef.current = false;
      });
      return cloneSnapshot(next);
    },
    [syncFlags],
  );

  const reset = useCallback(() => {
    pastRef.current = [];
    futureRef.current = [];
    dragHistoryRecordedRef.current = false;
    syncFlags();
  }, [syncFlags]);

  const noteDragStart = useCallback(() => {
    dragHistoryRecordedRef.current = true;
  }, []);

  const noteDragEnd = useCallback(() => {
    dragHistoryRecordedRef.current = false;
  }, []);

  const shouldRecordDragStart = useCallback(() => !dragHistoryRecordedRef.current, []);

  return {
    canUndo: flags.canUndo,
    canRedo: flags.canRedo,
    record,
    undo,
    redo,
    reset,
    noteDragStart,
    noteDragEnd,
    shouldRecordDragStart,
  };
}
