import { useCallback, useMemo, useState } from 'react';
import {
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
} from '@xyflow/react';
import { Layers, Play, Trash2 } from 'lucide-react';
import CommandPalette from './components/CommandPalette';
import ExecutionTerminal from './components/ExecutionTerminal';
import FlowCanvas from './components/FlowCanvas';
import NodeConfigurator from './components/NodeConfigurator';
import WorkflowGroupMenu from './components/WorkflowGroupMenu';
import type { CommandNodeData, TerminalLog, TerminalSession, WorkflowGroup, WorkflowGroupFrame } from './types';
import { generateYaml } from './utils/commandPreview';
import { executeCommandNode } from './utils/executeCommand';
import { parseYamlToParams } from './utils/yamlSync';
import {
  getEntryScheduleWait,
  removeNodeFromGroups,
  syncNodeWorkflowGroups,
  waitDuration,
} from './utils/workflowExecution';
import { nextWorkflowGroupColor, topologicalSort, topologicalSortSubset } from './utils/workflow';
import {
  fullCanvasSignature,
  groupSignature,
  singleNodeSignature,
  estimateGroupBounds,
  clampGroupFrame,
} from './utils/workflowSignature';
import { isWorkflowTool } from './data/k8sCommands';
import { getDirectInheritedContext } from './utils/workflowContext';
import './App.css';

let logCounter = 0;
function makeLog(level: TerminalLog['level'], message: string): TerminalLog {
  logCounter += 1;
  return { id: `log-${logCounter}`, level, message };
}

function createTerminalSession(name: string, starterLogs?: TerminalLog[]): TerminalSession {
  return {
    id: `term-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    logs:
      starterLogs ??
      [
        makeLog('system', 'system: Project:Genesis ready — drag commands, connect, configure, run.'),
        makeLog('system', `system: Backend proxy → localhost:${import.meta.env.VITE_BACKEND_PORT ?? '8787'}`),
      ],
    status: 'complete',
    createdAt: Date.now(),
  };
}

function AppShell() {
  const initialSession = createTerminalSession('Main');
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<CommandNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNode, setSelectedNode] = useState<Node<CommandNodeData> | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [workflowGroups, setWorkflowGroups] = useState<WorkflowGroup[]>([]);
  const [groupMode, setGroupMode] = useState(false);
  const [runningGroupIds, setRunningGroupIds] = useState<Set<string>>(new Set());
  const [highlightedGroupId, setHighlightedGroupId] = useState<string | null>(null);
  const [terminalSessions, setTerminalSessions] = useState<TerminalSession[]>([initialSession]);
  const [activeTerminalId, setActiveTerminalId] = useState(initialSession.id);
  const [terminalHeight, setTerminalHeight] = useState(220);

  const appendToSession = useCallback((sessionId: string, level: TerminalLog['level'], message: string) => {
    setTerminalSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId
          ? { ...session, logs: [...session.logs, makeLog(level, message)] }
          : session,
      ),
    );
  }, []);

  const appendToActiveSession = useCallback(
    (level: TerminalLog['level'], message: string) => {
      appendToSession(activeTerminalId, level, message);
    },
    [activeTerminalId, appendToSession],
  );

  const acquireRunSession = useCallback((name: string, signature: string) => {
    let sessionId = '';
    let shouldRun = true;

    setTerminalSessions((prev) => {
      const existing = prev.find((session) => session.workflowSignature === signature);

      if (existing) {
        sessionId = existing.id;
        if (existing.status === 'running') {
          shouldRun = false;
          return prev.map((session) =>
            session.id === existing.id
              ? {
                  ...session,
                  logs: [
                    ...session.logs,
                    makeLog('system', 'system: Same workflow already running in this tab.'),
                  ],
                }
              : session,
          );
        }

        shouldRun = true;
        const withoutDupes = prev.filter(
          (session) => session.workflowSignature !== signature || session.id === existing.id,
        );

        return withoutDupes.map((session) =>
          session.id === existing.id
            ? {
                ...session,
                name,
                status: 'running',
                logs: [makeLog('system', `system: Re-running "${name}"...`)],
              }
            : session,
        );
      }

      const session: TerminalSession = {
        ...createTerminalSession(name, [makeLog('system', `system: Opened terminal for "${name}".`)]),
        workflowSignature: signature,
        status: 'running',
      };
      sessionId = session.id;
      shouldRun = true;

      const withoutDupes = prev.filter((item) => item.workflowSignature !== signature);
      return [...withoutDupes, session];
    });

    if (sessionId) {
      setActiveTerminalId(sessionId);
    }
    return { sessionId, shouldRun };
  }, []);

  const applyGroupsToNodes = useCallback(
    (groups: WorkflowGroup[]) => {
      setNodes((nds) => syncNodeWorkflowGroups(nds, groups));
    },
    [setNodes],
  );

  const persistGroupHighlight = useCallback(
    (groupId: string, groupsOverride?: WorkflowGroup[]) => {
      setHighlightedGroupId(groupId);

      const applyHighlight = (groups: WorkflowGroup[]) => {
        const group = groups.find((item) => item.id === groupId);
        if (!group) return;

        setNodes((nds) => {
          const synced = syncNodeWorkflowGroups(
            nds.map((node) => ({
              ...node,
              selected: group.nodeIds.includes(node.id),
            })),
            groups,
          );

          if (group.nodeIds.length === 1) {
            setSelectedNode(synced.find((item) => item.id === group.nodeIds[0]) ?? null);
          } else {
            setSelectedNode(null);
          }

          return synced;
        });
        setSelectedNodeIds(group.nodeIds);
      };

      if (groupsOverride) {
        applyHighlight(groupsOverride);
        return;
      }

      setWorkflowGroups((groups) => {
        applyHighlight(groups);
        return groups;
      });
    },
    [setNodes],
  );

  const updateNodeStatus = useCallback(
    (nodeId: string, runStatus: CommandNodeData['runStatus']) => {
      setNodes((nds) =>
        nds.map((node) =>
          node.id === nodeId
            ? {
                ...node,
                data: {
                  ...node.data,
                  runStatus,
                  timerSeconds: runStatus === 'idle' ? null : node.data.timerSeconds,
                  timerTotalSeconds: runStatus === 'idle' ? null : node.data.timerTotalSeconds,
                },
              }
            : node,
        ),
      );
      setSelectedNode((current) =>
        current?.id === nodeId
          ? {
              ...current,
              data: {
                ...current.data,
                runStatus,
                timerSeconds: runStatus === 'idle' ? null : current.data.timerSeconds,
                timerTotalSeconds: runStatus === 'idle' ? null : current.data.timerTotalSeconds,
              },
            }
          : current,
      );
    },
    [setNodes],
  );

  const updateNodeTimer = useCallback(
    (
      nodeId: string,
      timer: { seconds: number | null; totalSeconds?: number | null },
    ) => {
      setNodes((nds) =>
        nds.map((node) =>
          node.id === nodeId
            ? {
                ...node,
                data: {
                  ...node.data,
                  timerSeconds: timer.seconds,
                  timerTotalSeconds:
                    timer.totalSeconds === undefined
                      ? node.data.timerTotalSeconds
                      : timer.totalSeconds,
                },
              }
            : node,
        ),
      );
      setSelectedNode((current) =>
        current?.id === nodeId
          ? {
              ...current,
              data: {
                ...current.data,
                timerSeconds: timer.seconds,
                timerTotalSeconds:
                  timer.totalSeconds === undefined
                    ? current.data.timerTotalSeconds
                    : timer.totalSeconds,
              },
            }
          : current,
      );
    },
    [setNodes],
  );

  const resetNodeStatusForIds = useCallback(
    (nodeIds: string[]) => {
      const allowed = new Set(nodeIds);
      setNodes((nds) =>
        nds.map((node) =>
          allowed.has(node.id)
            ? {
                ...node,
                data: {
                  ...node.data,
                  runStatus: 'idle',
                  timerSeconds: null,
                  timerTotalSeconds: null,
                },
              }
            : node,
        ),
      );
    },
    [setNodes],
  );

  const applyNodeParams = useCallback(
    (nodeId: string, params: Record<string, string>, yamlContent?: string) => {
      setNodes((nds) =>
        nds.map((node) => {
          if (node.id !== nodeId) return node;
          const nextYaml =
            yamlContent ??
            (isWorkflowTool(node.data.commandId)
              ? `# Workflow tool: ${node.data.label}`
              : generateYaml(node.data.commandId, params));
          return { ...node, data: { ...node.data, params, yamlContent: nextYaml } };
        }),
      );
      setSelectedNode((current) => {
        if (current?.id !== nodeId) return current;
        const nextYaml =
          yamlContent ??
          (isWorkflowTool(current.data.commandId)
            ? `# Workflow tool: ${current.data.label}`
            : generateYaml(current.data.commandId, params));
        return { ...current, data: { ...current.data, params, yamlContent: nextYaml } };
      });
    },
    [setNodes],
  );

  const handleParamChange = useCallback(
    (nodeId: string, key: string, value: string) => {
      const node = nodes.find((item) => item.id === nodeId);
      if (!node) return;
      const nextParams = { ...node.data.params, [key]: value };
      applyNodeParams(nodeId, nextParams);
    },
    [applyNodeParams, nodes],
  );

  const handleCustomFieldAdd = useCallback(
    (nodeId: string, key: string, value: string) => {
      handleParamChange(nodeId, key, value);
    },
    [handleParamChange],
  );

  const handleCustomFieldRemove = useCallback(
    (nodeId: string, key: string) => {
      const node = nodes.find((item) => item.id === nodeId);
      if (!node) return;
      const nextParams = { ...node.data.params };
      delete nextParams[key];
      applyNodeParams(nodeId, nextParams);
    },
    [applyNodeParams, nodes],
  );

  const handleYamlChange = useCallback(
    (nodeId: string, yamlContent: string) => {
      const node = nodes.find((item) => item.id === nodeId);
      if (!node) return;
      const nextParams = parseYamlToParams(node.data.commandId, yamlContent, node.data.params);
      applyNodeParams(nodeId, nextParams, yamlContent);
    },
    [applyNodeParams, nodes],
  );

  const handleContextChange = useCallback(
    (nodeId: string, context: string) => {
      setNodes((nds) =>
        nds.map((node) =>
          node.id === nodeId ? { ...node, data: { ...node.data, context } } : node,
        ),
      );
      setSelectedNode((current) =>
        current?.id === nodeId ? { ...current, data: { ...current.data, context } } : current,
      );
    },
    [setNodes],
  );

  const inheritedContext = useMemo(() => {
    if (!selectedNode) return '';
    return getDirectInheritedContext(selectedNode.id, nodes, edges);
  }, [selectedNode, nodes, edges]);

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      setNodes((nds) => nds.filter((node) => node.id !== nodeId));
      setEdges((eds) => eds.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
      setSelectedNode((current) => (current?.id === nodeId ? null : current));
      setSelectedNodeIds((current) => current.filter((id) => id !== nodeId));
      setWorkflowGroups((current) => {
        const next = removeNodeFromGroups(current, nodeId);
        applyGroupsToNodes(next);
        return next;
      });
      appendToActiveSession('system', 'system: Removed command node from canvas.');
    },
    [appendToActiveSession, applyGroupsToNodes, setEdges, setNodes],
  );

  const clearCanvas = () => {
    setNodes([]);
    setEdges([]);
    setSelectedNode(null);
    setSelectedNodeIds([]);
    setWorkflowGroups([]);
    appendToActiveSession('system', 'system: Canvas cleared.');
  };

  const finishRunSession = useCallback(
    (sessionId: string, groupId?: string) => {
      setTerminalSessions((prev) =>
        prev.map((session) =>
          session.id === sessionId ? { ...session, status: 'complete' } : session,
        ),
      );
      if (groupId) {
        setRunningGroupIds((prev) => {
          const next = new Set(prev);
          next.delete(groupId);
          return next;
        });
        persistGroupHighlight(groupId);
      }
    },
    [persistGroupHighlight],
  );

  const failRunSession = useCallback(
    (sessionId: string, groupId?: string) => {
      setTerminalSessions((prev) =>
        prev.map((session) => (session.id === sessionId ? { ...session, status: 'error' } : session)),
      );
      if (groupId) {
        setRunningGroupIds((prev) => {
          const next = new Set(prev);
          next.delete(groupId);
          return next;
        });
        persistGroupHighlight(groupId);
      }
    },
    [persistGroupHighlight],
  );

  const runNodesInSession = useCallback(
    async (
      sessionId: string,
      order: Node<CommandNodeData>[],
      label: string,
      groupId?: string,
    ) => {
      if (order.length === 0) {
        appendToSession(sessionId, 'error', '❌ Add at least one command node to the canvas.');
        failRunSession(sessionId, groupId);
        return;
      }

      const appendSessionLog = (level: TerminalLog['level'], message: string) => {
        appendToSession(sessionId, level, message);
      };

      const callbacks = {
        appendLog: appendSessionLog,
        updateNodeStatus,
        updateNodeTimer,
      };

      resetNodeStatusForIds(order.map((node) => node.id));
      appendSessionLog('run', `▶ ${label} (${order.length} step${order.length === 1 ? '' : 's'})...`);

      const graph = { nodes, edges };

      for (const node of order) {
        const ok = await executeCommandNode(node, callbacks, graph);
        if (!ok) {
          failRunSession(sessionId, groupId);
          return;
        }
      }

      appendSessionLog('success', '✓ Run complete.');
      finishRunSession(sessionId, groupId);
    },
    [
      appendToSession,
      edges,
      failRunSession,
      finishRunSession,
      nodes,
      resetNodeStatusForIds,
      updateNodeStatus,
      updateNodeTimer,
    ],
  );

  const runSubsetInSession = useCallback(
    async (sessionId: string, subsetNodeIds: string[], label: string, groupId?: string) => {
      const { order, error } = topologicalSortSubset(nodes, edges, subsetNodeIds);
      if (error) {
        appendToSession(sessionId, 'error', `❌ ${error}`);
        failRunSession(sessionId, groupId);
        return;
      }

      const subsetNodes = nodes.filter((node) => subsetNodeIds.includes(node.id));
      const subsetEdges = edges.filter(
        (edge) => subsetNodeIds.includes(edge.source) && subsetNodeIds.includes(edge.target),
      );

      const scheduleGate = getEntryScheduleWait(subsetNodes, subsetEdges);
      if (scheduleGate && scheduleGate.waitMs > 0) {
        appendToSession(
          sessionId,
          'run',
          `⏰ ${label} scheduled for ${scheduleGate.targetLabel}. Waiting before run...`,
        );
        await waitDuration(
          scheduleGate.waitMs,
          (level, message) => appendToSession(sessionId, level, message),
          label,
        );
      }

      await runNodesInSession(sessionId, order, label, groupId);
    },
    [appendToSession, edges, failRunSession, nodes, runNodesInSession],
  );

  const runWorkflow = () => {
    const { order, error } = topologicalSort(nodes, edges);
    if (error) {
      appendToActiveSession('error', `❌ ${error}`);
      return;
    }

    const signature = fullCanvasSignature(nodes, edges);
    const { sessionId, shouldRun } = acquireRunSession('Full Workflow', signature);
    if (!shouldRun) return;

    void (async () => {
      const scheduleGate = getEntryScheduleWait(nodes, edges);
      if (scheduleGate && scheduleGate.waitMs > 0) {
        appendToSession(
          sessionId,
          'run',
          `⏰ Workflow scheduled for ${scheduleGate.targetLabel}. Waiting before run...`,
        );
        await waitDuration(
          scheduleGate.waitMs,
          (level, message) => appendToSession(sessionId, level, message),
          'Workflow schedule',
        );
      }

      await runNodesInSession(sessionId, order, 'Running workflow');
    })();
  };

  const runSingleNode = useCallback(
    (nodeId: string) => {
      const node = nodes.find((item) => item.id === nodeId);
      if (!node || node.data.runStatus === 'running') return;
      const { sessionId, shouldRun } = acquireRunSession(
        node.data.label,
        singleNodeSignature(node),
      );
      if (!shouldRun) return;
      void runNodesInSession(sessionId, [node], `Running ${node.data.label}`);
    },
    [acquireRunSession, nodes, runNodesInSession],
  );

  const handleSaveGroup = useCallback(
    (name: string, nodeIds: string[]) => {
      const uniqueIds = [...new Set(nodeIds)];
      const groupNodes = nodes.filter((node) => uniqueIds.includes(node.id));
      const bounds = estimateGroupBounds(groupNodes);
      const nextGroup: WorkflowGroup = {
        id: `group-${Date.now()}`,
        name,
        nodeIds: uniqueIds,
        color: nextWorkflowGroupColor(workflowGroups.length),
        frame: bounds ? clampGroupFrame(bounds) : undefined,
      };

      const withoutOverlaps = workflowGroups
        .map((group) => ({
          ...group,
          nodeIds: group.nodeIds.filter((id) => !uniqueIds.includes(id)),
        }))
        .filter((group) => group.nodeIds.length > 0);

      const nextGroups = [...withoutOverlaps, nextGroup];
      setWorkflowGroups(nextGroups);
      persistGroupHighlight(nextGroup.id, nextGroups);
      appendToActiveSession('system', `system: Saved workflow group "${name}" (${uniqueIds.length} nodes).`);
    },
    [appendToActiveSession, nodes, persistGroupHighlight, workflowGroups],
  );

  const handleResizeGroup = useCallback((groupId: string, frame: WorkflowGroupFrame) => {
    setWorkflowGroups((current) =>
      current.map((group) =>
        group.id === groupId ? { ...group, frame: clampGroupFrame(frame) } : group,
      ),
    );
  }, []);

  const handleUngroupGroup = useCallback(
    (groupId: string) => {
      const group = workflowGroups.find((item) => item.id === groupId);
      setWorkflowGroups((current) => {
        const next = current.filter((item) => item.id !== groupId);
        applyGroupsToNodes(next);
        return next;
      });
      if (highlightedGroupId === groupId) {
        setHighlightedGroupId(null);
        setSelectedNodeIds([]);
        setNodes((nds) => nds.map((node) => ({ ...node, selected: false })));
      }
      appendToActiveSession(
        'system',
        `system: Ungrouped "${group?.name ?? 'group'}". Nodes kept on canvas.`,
      );
    },
    [appendToActiveSession, applyGroupsToNodes, highlightedGroupId, setNodes, workflowGroups],
  );

  const handleDeleteGroupWithNodes = useCallback(
    (groupId: string) => {
      const group = workflowGroups.find((item) => item.id === groupId);
      if (!group) return;

      const nodeIds = new Set(group.nodeIds);
      setNodes((nds) => nds.filter((node) => !nodeIds.has(node.id)));
      setEdges((eds) => eds.filter((edge) => !nodeIds.has(edge.source) && !nodeIds.has(edge.target)));
      setSelectedNode((current) => (current && nodeIds.has(current.id) ? null : current));
      setSelectedNodeIds((current) => current.filter((id) => !nodeIds.has(id)));
      setWorkflowGroups((current) => {
        const next = current.filter((item) => item.id !== groupId);
        applyGroupsToNodes(next);
        return next;
      });
      if (highlightedGroupId === groupId) {
        setHighlightedGroupId(null);
      }
      appendToActiveSession(
        'system',
        `system: Deleted group "${group.name}" and ${group.nodeIds.length} node(s).`,
      );
    },
    [appendToActiveSession, applyGroupsToNodes, highlightedGroupId, setEdges, setNodes, workflowGroups],
  );

  const handleDeleteGroup = useCallback(
    (groupId: string) => {
      setWorkflowGroups((current) => {
        const next = current.filter((group) => group.id !== groupId);
        applyGroupsToNodes(next);
        return next;
      });
      if (highlightedGroupId === groupId) {
        setHighlightedGroupId(null);
        setSelectedNodeIds([]);
        setNodes((nds) => nds.map((node) => ({ ...node, selected: false })));
      }
      appendToActiveSession('system', 'system: Removed workflow group.');
    },
    [appendToActiveSession, applyGroupsToNodes, highlightedGroupId, setNodes],
  );

  const handleRunGroup = useCallback(
    (groupId: string) => {
      const group = workflowGroups.find((item) => item.id === groupId);
      if (!group || runningGroupIds.has(groupId)) return;

      const signature = groupSignature(group.id, group.nodeIds, edges);
      const { sessionId, shouldRun } = acquireRunSession(group.name, signature);
      if (!shouldRun) return;

      persistGroupHighlight(groupId);
      setRunningGroupIds((prev) => new Set(prev).add(groupId));
      void runSubsetInSession(
        sessionId,
        group.nodeIds,
        `Running group "${group.name}"`,
        groupId,
      );
    },
    [acquireRunSession, edges, persistGroupHighlight, runSubsetInSession, runningGroupIds, workflowGroups],
  );

  const handleHighlightGroup = useCallback(
    (groupId: string) => {
      persistGroupHighlight(groupId);
    },
    [persistGroupHighlight],
  );

  const handleCloseTerminal = useCallback(
    (sessionId: string) => {
      setTerminalSessions((prev) => {
        if (prev.length <= 1) return prev;
        const next = prev.filter((session) => session.id !== sessionId);
        if (activeTerminalId === sessionId) {
          setActiveTerminalId(next[next.length - 1].id);
        }
        return next;
      });
    },
    [activeTerminalId],
  );

  const handleClearTerminal = useCallback((sessionId: string) => {
    setTerminalSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId ? { ...session, logs: [] } : session,
      ),
    );
  }, []);

  const hasRunningSessions = terminalSessions.some((session) => session.status === 'running');

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__brand">
          <Layers size={22} />
          <div>
            <h1>Project:Genesis</h1>
            <p>Visual kubectl workflow builder</p>
          </div>
        </div>
        <div className="app__actions">
          <WorkflowGroupMenu
            groups={workflowGroups}
            selectedNodeIds={selectedNodeIds}
            groupMode={groupMode}
            runningGroupIds={runningGroupIds}
            onGroupModeChange={setGroupMode}
            onSaveGroup={handleSaveGroup}
            onRunGroup={handleRunGroup}
            onDeleteGroup={handleDeleteGroup}
            onHighlightGroup={handleHighlightGroup}
          />
          <button type="button" className="btn btn--ghost" onClick={clearCanvas} disabled={hasRunningSessions}>
            <Trash2 size={16} />
            Clear Canvas
          </button>
          <button type="button" className="btn btn--primary" onClick={runWorkflow}>
            <Play size={16} />
            Run Workflow
          </button>
        </div>
      </header>

      <main className="app__workspace">
        <CommandPalette />
        <FlowCanvas
          nodes={nodes}
          edges={edges}
          workflowGroups={workflowGroups}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          setNodes={setNodes}
          setEdges={setEdges}
          onNodeSelect={setSelectedNode}
          onSelectionChange={setSelectedNodeIds}
          onRunNode={runSingleNode}
          onDeleteNode={handleDeleteNode}
          onRunGroup={handleRunGroup}
          onUngroupGroup={handleUngroupGroup}
          onDeleteGroupNodes={handleDeleteGroupWithNodes}
          onResizeGroup={handleResizeGroup}
          highlightedGroupId={highlightedGroupId}
          runningGroupIds={runningGroupIds}
          isRunning={false}
          groupMode={groupMode}
        />
        <NodeConfigurator
          node={selectedNode}
          inheritedContext={inheritedContext}
          onParamChange={handleParamChange}
          onCustomFieldAdd={handleCustomFieldAdd}
          onCustomFieldRemove={handleCustomFieldRemove}
          onYamlChange={handleYamlChange}
          onContextChange={handleContextChange}
        />
      </main>

      <ExecutionTerminal
        sessions={terminalSessions}
        activeSessionId={activeTerminalId}
        onActiveSessionChange={setActiveTerminalId}
        onCloseSession={handleCloseTerminal}
        onClearSession={handleClearTerminal}
        height={terminalHeight}
        onHeightChange={setTerminalHeight}
      />
    </div>
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <AppShell />
    </ReactFlowProvider>
  );
}
