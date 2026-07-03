import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  addEdge,
  applyEdgeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import {
  Layers,
  Menu,
  PanelLeftClose,
  PanelRightClose,
  PanelRightOpen,
  Play,
  Redo2,
  Save,
  Settings,
  Undo2,
} from 'lucide-react';
import CommandPalette from './components/CommandPalette';
import ExecutionTerminal from './components/ExecutionTerminal';
import FlowCanvas from './components/FlowCanvas';
import NodeConfigurator from './components/NodeConfigurator';
import WorkflowGroupMenu from './components/WorkflowGroupMenu';
import GlobalContextMenu from './components/GlobalContextMenu';
import SettingsPage from './components/SettingsPage';
import ToolbarOverflowMenu from './components/ToolbarOverflowMenu';
import type { CommandNodeData, SavedKubeContext, SavedSlackProfile, TerminalLog, TerminalSession, WorkflowGroup, WorkflowGroupFrame } from './types';
import { generateYaml } from './utils/commandPreview';
import { executeCommandNode } from './utils/executeCommand';
import { RunController } from './utils/runControl';
import { parseYamlToParams } from './utils/yamlSync';
import {
  getEntryScheduleWait,
  removeNodeFromGroups,
  syncNodeWorkflowGroups,
  waitDuration,
} from './utils/workflowExecution';
import { expandRunSelection, nextWorkflowGroupColor, topologicalSort, topologicalSortSubset } from './utils/workflow';
import { branchEdgeMeta, runBranchingWorkflow } from './utils/workflowBranching';
import type { StepOutputRecord } from './utils/workflowRunContext';
import { applyWorkflowBounds, canvasHasStartNode, getStartScopedNodeIds, markNodesOutsideScope } from './utils/workflowBounds';
import {
  GROUP_BACKGROUND_PREFIX,
  fullCanvasSignature,
  groupSignature,
  singleNodeSignature,
  workflowSignature,
  estimateGroupBounds,
  clampGroupFrame,
} from './utils/workflowSignature';
import { isIntegrationCommand, isWorkflowTool } from './data/k8sCommands';
import {
  getDirectInheritedContext,
  getDirectInheritedNamespace,
  refreshNodesForGlobalContext,
  syncWorkflowInheritance,
} from './utils/workflowContext';
import {
  buildWorkflowProjectPayload,
  createWorkflowProject,
  deleteWorkflowProject,
  getWorkflowProject,
  normalizeLoadedProjectPayload,
  projectPayloadSignature,
  renameWorkflowProject,
  updateWorkflowProject,
} from './utils/workflowProjects';
import WorkflowProjectsMenu from './components/WorkflowProjectsMenu';
import WorkflowStatusBar from './components/WorkflowStatusBar';
import ProjectModal, { type ProjectModalMode } from './components/ProjectModal';
import {
  createSavedContext,
  getActiveGlobalContext,
  loadSavedContexts,
  persistSavedContexts,
} from './utils/savedContexts';
import {
  createSavedSlackProfile,
  loadSavedSlackProfiles,
  persistSavedSlackProfiles,
} from './utils/savedSlackProfiles';
import { useCanvasHistory, type CanvasSnapshot } from './hooks/useCanvasHistory';
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
  const [edges, setEdges, _onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNode, setSelectedNode] = useState<Node<CommandNodeData> | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [configPanelOpen, setConfigPanelOpen] = useState(true);
  const [workloadsPanelOpen, setWorkloadsPanelOpen] = useState(true);
  const [workflowGroups, setWorkflowGroups] = useState<WorkflowGroup[]>([]);
  const [runningGroupIds, setRunningGroupIds] = useState<Set<string>>(new Set());
  const [highlightedGroupId, setHighlightedGroupId] = useState<string | null>(null);
  const [terminalSessions, setTerminalSessions] = useState<TerminalSession[]>([initialSession]);
  const [activeTerminalId, setActiveTerminalId] = useState(initialSession.id);
  const [terminalHeight, setTerminalHeight] = useState(220);
  const [savedContexts, setSavedContexts] = useState<SavedKubeContext[]>(() => loadSavedContexts());
  const [savedSlackProfiles, setSavedSlackProfiles] = useState<SavedSlackProfile[]>(() =>
    loadSavedSlackProfiles(),
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const canvasHistory = useCanvasHistory();
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeProjectName, setActiveProjectName] = useState<string | null>(null);
  const [savedProjectSnapshot, setSavedProjectSnapshot] = useState<string | null>(null);
  const [projectActionBusy, setProjectActionBusy] = useState(false);
  const [projectsRefreshKey, setProjectsRefreshKey] = useState(0);
  const [projectModal, setProjectModal] = useState<
    | { type: 'save' }
    | { type: 'edit'; id: string; name: string }
    | { type: 'delete'; id: string; name: string }
    | null
  >(null);
  const [modalName, setModalName] = useState('');
  const [modalError, setModalError] = useState('');
  const runControllersRef = useRef<Map<string, RunController>>(new Map());
  const sessionRunMetaRef = useRef<Map<string, { groupId?: string; nodeIds: string[] }>>(new Map());

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

  const getNodeIdsActiveInOtherSessions = useCallback((sessionId: string) => {
    const ids = new Set<string>();
    for (const [otherSessionId, meta] of sessionRunMetaRef.current) {
      if (otherSessionId === sessionId) continue;
      if (!runControllersRef.current.has(otherSessionId)) continue;
      meta.nodeIds.forEach((nodeId) => ids.add(nodeId));
    }
    return ids;
  }, []);

  const makeRunSessionName = useCallback((baseName: string, sessions: TerminalSession[]) => {
    const matching = sessions.filter(
      (session) => session.name === baseName || session.name.startsWith(`${baseName} (`),
    );
    if (matching.length === 0) return baseName;
    return `${baseName} (${matching.length + 1})`;
  }, []);

  const acquireRunSession = useCallback((name: string, signature: string) => {
    let sessionId = '';

    setTerminalSessions((prev) => {
      const displayName = makeRunSessionName(name, prev);
      const session: TerminalSession = {
        ...createTerminalSession(displayName, [
          makeLog('system', `system: Opened terminal for "${displayName}".`),
        ]),
        workflowSignature: signature,
        status: 'running',
      };
      sessionId = session.id;
      return [...prev, session];
    });

    setActiveTerminalId(sessionId);
    return { sessionId, shouldRun: true as const };
  }, [makeRunSessionName]);

  const applyGroupsToNodes = useCallback(
    (groups: WorkflowGroup[]) => {
      setNodes((nds) => syncNodeWorkflowGroups(nds, groups));
    },
    [setNodes],
  );

  const getCanvasSnapshot = useCallback(
    (): CanvasSnapshot => ({
      nodes,
      edges,
      workflowGroups,
    }),
    [edges, nodes, workflowGroups],
  );

  const recordCanvasHistory = useCallback(() => {
    canvasHistory.record(getCanvasSnapshot());
  }, [canvasHistory, getCanvasSnapshot]);

  const applyCanvasSnapshot = useCallback(
    (snapshot: CanvasSnapshot) => {
      setNodes(snapshot.nodes);
      setEdges(snapshot.edges);
      setWorkflowGroups(snapshot.workflowGroups);
      applyGroupsToNodes(snapshot.workflowGroups);
      setSelectedNode(null);
      setSelectedNodeIds([]);
      setHighlightedGroupId(null);
    },
    [applyGroupsToNodes, setEdges, setNodes],
  );

  const handleUndoCanvas = useCallback(() => {
    const previous = canvasHistory.undo(getCanvasSnapshot());
    if (!previous) return;
    applyCanvasSnapshot(previous);
    appendToActiveSession('system', 'system: Undo canvas change.');
  }, [applyCanvasSnapshot, appendToActiveSession, canvasHistory, getCanvasSnapshot]);

  const handleRedoCanvas = useCallback(() => {
    const next = canvasHistory.redo(getCanvasSnapshot());
    if (!next) return;
    applyCanvasSnapshot(next);
    appendToActiveSession('system', 'system: Redo canvas change.');
  }, [applyCanvasSnapshot, appendToActiveSession, canvasHistory, getCanvasSnapshot]);

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
      setNodes((nds) => {
        const node = nds.find((item) => item.id === nodeId);
        if (!node) return nds;

        const nextYaml =
          yamlContent ??
          (isWorkflowTool(node.data.commandId)
            ? `# Workflow tool: ${node.data.label}`
            : isIntegrationCommand(node.data.commandId)
              ? `# Integration: ${node.data.label}`
              : generateYaml(node.data.commandId, params));

        const updated = nds.map((item) =>
          item.id === nodeId
            ? { ...item, data: { ...item.data, params, yamlContent: nextYaml } }
            : item,
        );

        return syncWorkflowInheritance(
          updated,
          edges,
          nodeId,
          getActiveGlobalContext(savedContexts),
        );
      });

      setSelectedNode((current) => {
        if (current?.id !== nodeId) return current;
        const nextYaml =
          yamlContent ??
          (isWorkflowTool(current.data.commandId)
            ? `# Workflow tool: ${current.data.label}`
            : isIntegrationCommand(current.data.commandId)
              ? `# Integration: ${current.data.label}`
              : generateYaml(current.data.commandId, params));
        return { ...current, data: { ...current.data, params, yamlContent: nextYaml } };
      });
    },
    [edges, savedContexts, setNodes],
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
      setNodes((nds) => {
        const updated = nds.map((node) =>
          node.id === nodeId ? { ...node, data: { ...node.data, context } } : node,
        );
        return syncWorkflowInheritance(
          updated,
          edges,
          nodeId,
          getActiveGlobalContext(savedContexts),
        );
      });
      setSelectedNode((current) =>
        current?.id === nodeId ? { ...current, data: { ...current.data, context } } : current,
      );
    },
    [edges, savedContexts, setNodes],
  );

  const inheritedContext = useMemo(() => {
    if (!selectedNode) return '';
    return getDirectInheritedContext(selectedNode.id, nodes, edges);
  }, [selectedNode, nodes, edges]);

  const inheritedNamespace = useMemo(() => {
    if (!selectedNode) return '';
    return getDirectInheritedNamespace(selectedNode.id, nodes, edges);
  }, [selectedNode, nodes, edges]);

  const globalContext = useMemo(() => getActiveGlobalContext(savedContexts), [savedContexts]);
  const previousGlobalContextRef = useRef(globalContext);

  useEffect(() => {
    const previousGlobal = previousGlobalContextRef.current;
    if (previousGlobal === globalContext) return;
    previousGlobalContextRef.current = globalContext;

    setNodes((nds) => {
      const synced = refreshNodesForGlobalContext(nds, edges, previousGlobal, globalContext);
      setSelectedNode((current) => {
        if (!current) return current;
        return synced.find((node) => node.id === current.id) ?? current;
      });
      return synced;
    });
  }, [edges, globalContext, setNodes]);

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;

      if (connection.source === connection.target) {
        appendToActiveSession('warn', 'system: Cannot connect a node to itself.');
        return;
      }

      recordCanvasHistory();

      setEdges((eds) => {
        const sourceNode = nodes.find((node) => node.id === connection.source);
        const branchMeta = branchEdgeMeta(sourceNode, connection.sourceHandle);
        const nextEdges = addEdge(
          {
            ...connection,
            animated: true,
            data: branchMeta.data,
            label: branchMeta.label,
            style: branchMeta.style,
            labelStyle: branchMeta.labelStyle,
          },
          eds,
        );
        setNodes((nds) => {
          const synced = syncWorkflowInheritance(
            nds,
            nextEdges,
            connection.target!,
            globalContext,
          );
          setSelectedNode((current) => {
            if (current?.id !== connection.target) return current;
            return synced.find((node) => node.id === connection.target) ?? current;
          });
          return synced;
        });
        return nextEdges;
      });
    },
    [appendToActiveSession, globalContext, nodes, recordCanvasHistory, setEdges, setNodes],
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange<Node<CommandNodeData>>[]) => {
      const removedIds = changes
        .filter((change): change is NodeChange & { type: 'remove'; id: string } => change.type === 'remove')
        .map((change) => change.id);
      const dragStart = changes.some((change) => change.type === 'position' && change.dragging === true);
      const dragEnd = changes.some((change) => change.type === 'position' && change.dragging === false);

      if (dragStart && canvasHistory.shouldRecordDragStart()) {
        recordCanvasHistory();
        canvasHistory.noteDragStart();
      }
      if (dragEnd) {
        canvasHistory.noteDragEnd();
      }
      if (removedIds.length > 0) {
        recordCanvasHistory();
        setWorkflowGroups((current) => {
          let next = current;
          for (const nodeId of removedIds) {
            next = removeNodeFromGroups(next, nodeId);
          }
          applyGroupsToNodes(next);
          return next;
        });
        setSelectedNode((current) => (current && removedIds.includes(current.id) ? null : current));
        setSelectedNodeIds((current) => current.filter((id) => !removedIds.includes(id)));
      }

      onNodesChange(changes);
    },
    [applyGroupsToNodes, canvasHistory, onNodesChange, recordCanvasHistory],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const hasRemove = changes.some((change) => change.type === 'remove');
      if (hasRemove) {
        recordCanvasHistory();
      }

      setEdges((currentEdges) => {
        const removedEdgeIds = changes
          .filter((change): change is EdgeChange & { type: 'remove'; id: string } => change.type === 'remove')
          .map((change) => change.id);
        const affectedNodeIds = new Set(
          currentEdges
            .filter((edge) => removedEdgeIds.includes(edge.id))
            .flatMap((edge) => [edge.source, edge.target]),
        );
        const nextEdges = applyEdgeChanges(changes, currentEdges);
        if (hasRemove && affectedNodeIds.size > 0) {
          setNodes((currentNodes) => {
            let nextNodes = currentNodes;
            for (const nodeId of affectedNodeIds) {
              nextNodes = syncWorkflowInheritance(nextNodes, nextEdges, nodeId, globalContext);
            }
            return nextNodes;
          });
        }
        return nextEdges;
      });
    },
    [globalContext, recordCanvasHistory, setEdges, setNodes],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;

      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault();
        handleUndoCanvas();
        return;
      }
      if (mod && ((event.key.toLowerCase() === 'z' && event.shiftKey) || event.key.toLowerCase() === 'y')) {
        event.preventDefault();
        handleRedoCanvas();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleRedoCanvas, handleUndoCanvas]);

  const handleAddSavedContext = useCallback((name: string) => {
    setSavedContexts((prev) => {
      const next = [...prev, createSavedContext(name)];
      persistSavedContexts(next);
      return next;
    });
    appendToActiveSession('system', `system: Saved kube context "${name}".`);
  }, [appendToActiveSession]);

  const handleUpdateSavedContext = useCallback((id: string, name: string) => {
    setSavedContexts((prev) => {
      const next = prev.map((item) => (item.id === id ? { ...item, name } : item));
      persistSavedContexts(next);
      return next;
    });
    appendToActiveSession('system', `system: Updated kube context to "${name}".`);
  }, [appendToActiveSession]);

  const handleDeleteSavedContext = useCallback((id: string) => {
    setSavedContexts((prev) => {
      const target = prev.find((item) => item.id === id);
      const next = prev.filter((item) => item.id !== id);
      persistSavedContexts(next);
      if (target) {
        appendToActiveSession('system', `system: Deleted kube context "${target.name}".`);
      }
      return next;
    });
  }, [appendToActiveSession]);

  const handleToggleSavedContext = useCallback((id: string, enabled: boolean) => {
    setSavedContexts((prev) => {
      const next = prev.map((item) => {
        if (item.id === id) return { ...item, enabled };
        if (enabled) return { ...item, enabled: false };
        return item;
      });
      persistSavedContexts(next);
      const active = next.find((item) => item.enabled);
      appendToActiveSession(
        'system',
        enabled && active
          ? `system: Global kube context enabled: --context ${active.name}`
          : 'system: Global kube context disabled.',
      );
      return next;
    });
  }, [appendToActiveSession]);

  const handleAddSavedSlackProfile = useCallback((name: string) => {
    setSavedSlackProfiles((prev) => {
      const next = [...prev, createSavedSlackProfile(name)];
      persistSavedSlackProfiles(next);
      return next;
    });
    appendToActiveSession('system', `system: Saved Slack profile "${name}".`);
  }, [appendToActiveSession]);

  const handleUpdateSavedSlackProfile = useCallback((id: string, patch: Partial<SavedSlackProfile>) => {
    setSavedSlackProfiles((prev) => {
      const next = prev.map((item) => (item.id === id ? { ...item, ...patch } : item));
      persistSavedSlackProfiles(next);
      return next;
    });
    if (patch.name) {
      appendToActiveSession('system', `system: Updated Slack profile "${patch.name}".`);
    }
  }, [appendToActiveSession]);

  const handleDeleteSavedSlackProfile = useCallback((id: string) => {
    setSavedSlackProfiles((prev) => {
      const target = prev.find((item) => item.id === id);
      const next = prev.filter((item) => item.id !== id);
      persistSavedSlackProfiles(next);
      if (target) {
        appendToActiveSession('system', `system: Deleted Slack profile "${target.name}".`);
      }
      return next;
    });
  }, [appendToActiveSession]);

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      recordCanvasHistory();
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
    [appendToActiveSession, applyGroupsToNodes, recordCanvasHistory, setEdges, setNodes],
  );

  const resetCanvasWorkflow = useCallback(
    (options?: { clearActiveProject?: boolean; logMessage?: string }) => {
      if (nodes.length > 0 || edges.length > 0 || workflowGroups.length > 0) {
        recordCanvasHistory();
      }
      setNodes([]);
      setEdges([]);
      setSelectedNode(null);
      setSelectedNodeIds([]);
      setWorkflowGroups([]);
      setHighlightedGroupId(null);
      if (options?.clearActiveProject !== false) {
        setActiveProjectId(null);
        setActiveProjectName(null);
        setSavedProjectSnapshot(null);
      }
      if (options?.logMessage) {
        appendToActiveSession('system', options.logMessage);
      }
    },
    [appendToActiveSession, edges.length, nodes.length, recordCanvasHistory, setEdges, setNodes, workflowGroups.length],
  );

  const clearCanvas = () => {
    resetCanvasWorkflow({ logMessage: 'system: Canvas cleared.' });
  };

  const saveProjectCore = useCallback(
    async (name: string, saveAsNew: boolean) => {
      const payload = buildWorkflowProjectPayload(
        nodes,
        edges,
        workflowGroups,
        savedContexts,
        savedSlackProfiles,
      );
      if (saveAsNew || !activeProjectId) {
        const project = await createWorkflowProject(name, payload);
        setActiveProjectId(project.id);
        setActiveProjectName(project.name);
        setSavedProjectSnapshot(projectPayloadSignature(nodes, edges, workflowGroups, savedContexts, savedSlackProfiles));
        appendToActiveSession('system', `system: Saved project "${project.name}".`);
        return;
      }

      const project = await updateWorkflowProject(activeProjectId, name, payload);
      setActiveProjectName(project.name);
      setSavedProjectSnapshot(projectPayloadSignature(nodes, edges, workflowGroups, savedContexts, savedSlackProfiles));
      appendToActiveSession('system', `system: Updated project "${project.name}".`);
    },
    [activeProjectId, appendToActiveSession, edges, nodes, savedContexts, savedSlackProfiles, workflowGroups],
  );

  const handleNewProject = useCallback(() => {
    resetCanvasWorkflow({ logMessage: 'system: Started new blank project canvas.' });
  }, [resetCanvasWorkflow]);

  const handleQuickSaveProject = useCallback(async () => {
    if (!activeProjectId || !activeProjectName) {
      setModalName('');
      setModalError('');
      setProjectModal({ type: 'save' });
      return;
    }

    setProjectActionBusy(true);
    try {
      await saveProjectCore(activeProjectName, false);
      setProjectsRefreshKey((current) => current + 1);
    } catch (error) {
      appendToActiveSession(
        'error',
        `❌ ${error instanceof Error ? error.message : 'Could not save workflow project.'}`,
      );
    } finally {
      setProjectActionBusy(false);
    }
  }, [activeProjectId, activeProjectName, appendToActiveSession, saveProjectCore]);

  const handleLoadProject = useCallback(
    async (projectId: string) => {
      setProjectActionBusy(true);
      try {
        const project = await getWorkflowProject(projectId);
        const payload = normalizeLoadedProjectPayload(project.payload);
        const loadedContexts =
          payload.savedContexts && payload.savedContexts.length > 0
            ? payload.savedContexts
            : savedContexts;
        const previousGlobal = getActiveGlobalContext(savedContexts);
        const loadedGlobal = getActiveGlobalContext(loadedContexts);
        const loadedNodes = refreshNodesForGlobalContext(
          payload.nodes,
          payload.edges,
          previousGlobal,
          loadedGlobal,
        );
        setNodes(loadedNodes);
        setEdges(payload.edges);
        setWorkflowGroups(payload.workflowGroups);
        applyGroupsToNodes(payload.workflowGroups);
        if (payload.savedContexts && payload.savedContexts.length > 0) {
          setSavedContexts(payload.savedContexts);
          persistSavedContexts(payload.savedContexts);
          previousGlobalContextRef.current = loadedGlobal;
        }
        if (payload.savedSlackProfiles && payload.savedSlackProfiles.length > 0) {
          setSavedSlackProfiles(payload.savedSlackProfiles);
          persistSavedSlackProfiles(payload.savedSlackProfiles);
        }
        setActiveProjectId(project.id);
        setActiveProjectName(project.name);
        setSavedProjectSnapshot(
          projectPayloadSignature(
            loadedNodes,
            payload.edges,
            payload.workflowGroups,
            loadedContexts,
            payload.savedSlackProfiles ?? [],
          ),
        );
        setSelectedNode(null);
        setSelectedNodeIds([]);
        setHighlightedGroupId(null);
        canvasHistory.reset();
        appendToActiveSession('system', `system: Loaded project "${project.name}".`);
      } finally {
        setProjectActionBusy(false);
      }
    },
    [appendToActiveSession, applyGroupsToNodes, canvasHistory, savedContexts, setEdges, setNodes],
  );

  const handleProjectModalConfirm = useCallback(async () => {
    if (!projectModal) return;

    setModalError('');
    setProjectActionBusy(true);
    try {
      if (projectModal.type === 'save') {
        await saveProjectCore(modalName.trim(), true);
      } else if (projectModal.type === 'edit') {
        const nextName = modalName.trim();
        await renameWorkflowProject(projectModal.id, nextName);
        if (activeProjectId === projectModal.id) {
          setActiveProjectName(nextName);
        }
        appendToActiveSession('system', `system: Renamed project to "${nextName}".`);
      } else {
        await deleteWorkflowProject(projectModal.id);
        if (activeProjectId === projectModal.id) {
          resetCanvasWorkflow({
            clearActiveProject: true,
            logMessage: `system: Deleted project "${projectModal.name}" and cleared canvas.`,
          });
        } else {
          appendToActiveSession('system', `system: Deleted project "${projectModal.name}".`);
        }
      }

      setProjectModal(null);
      setProjectsRefreshKey((current) => current + 1);
    } catch (error) {
      setModalError(error instanceof Error ? error.message : 'Could not complete project action.');
    } finally {
      setProjectActionBusy(false);
    }
  }, [activeProjectId, appendToActiveSession, modalName, projectModal, resetCanvasWorkflow, saveProjectCore]);

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
      runControllersRef.current.delete(sessionId);
      sessionRunMetaRef.current.delete(sessionId);
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

  const stopRunSession = useCallback(
    (sessionId: string, options?: { log?: boolean }) => {
      const control = runControllersRef.current.get(sessionId);
      if (control && !control.isStopped()) {
        control.stop();
      }
      runControllersRef.current.delete(sessionId);

      const meta = sessionRunMetaRef.current.get(sessionId);
      sessionRunMetaRef.current.delete(sessionId);

      if (meta?.nodeIds.length) {
        const busyElsewhere = getNodeIdsActiveInOtherSessions(sessionId);
        resetNodeStatusForIds(meta.nodeIds.filter((nodeId) => !busyElsewhere.has(nodeId)));
      }

      setTerminalSessions((prev) =>
        prev.map((session) => {
          if (session.id !== sessionId) return session;
          const alreadyStopped = session.status === 'stopped';
          return {
            ...session,
            status: 'stopped',
            logs:
              options?.log !== false && !alreadyStopped
                ? [...session.logs, makeLog('warn', '⏹ Workflow stopped.')]
                : session.logs,
          };
        }),
      );

      if (meta?.groupId) {
        setRunningGroupIds((prev) => {
          const next = new Set(prev);
          next.delete(meta.groupId!);
          return next;
        });
        persistGroupHighlight(meta.groupId);
      }
    },
    [getNodeIdsActiveInOtherSessions, persistGroupHighlight, resetNodeStatusForIds],
  );

  const handlePauseRun = useCallback((sessionId: string) => {
    const control = runControllersRef.current.get(sessionId);
    if (!control || control.state !== 'running') return;

    control.pause();
    setTerminalSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              status: 'paused',
              logs: [...session.logs, makeLog('warn', '⏸ Workflow paused.')],
            }
          : session,
      ),
    );
  }, []);

  const handleResumeRun = useCallback((sessionId: string) => {
    const control = runControllersRef.current.get(sessionId);
    if (!control || control.state !== 'paused') return;

    control.resume();
    setTerminalSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              status: 'running',
              logs: [...session.logs, makeLog('run', '▶ Workflow resumed.')],
            }
          : session,
      ),
    );
  }, []);

  const handleStopRun = useCallback(
    (sessionId: string) => {
      stopRunSession(sessionId);
    },
    [stopRunSession],
  );

  const runNodesInSession = useCallback(
    async (
      sessionId: string,
      order: Node<CommandNodeData>[],
      label: string,
      groupId?: string,
      existingControl?: RunController,
    ) => {
      if (order.length === 0) {
        appendToSession(sessionId, 'error', '❌ Add at least one command node to the canvas.');
        failRunSession(sessionId, groupId);
        return;
      }

      const control = existingControl ?? new RunController();
      if (!existingControl) {
        runControllersRef.current.set(sessionId, control);
      }
      sessionRunMetaRef.current.set(sessionId, {
        groupId,
        nodeIds: order.map((node) => node.id),
      });

      const appendSessionLog = (level: TerminalLog['level'], message: string) => {
        appendToSession(sessionId, level, message);
      };

      const callbacks = {
        appendLog: appendSessionLog,
        updateNodeStatus,
        updateNodeTimer,
        control,
      };

      resetNodeStatusForIds(
        order
          .map((node) => node.id)
          .filter((nodeId) => !getNodeIdsActiveInOtherSessions(sessionId).has(nodeId)),
      );
      appendSessionLog('run', `▶ ${label} (${order.length} step${order.length === 1 ? '' : 's'})...`);

      const stepOutputs = new Map<string, StepOutputRecord>();
      const graph = { nodes, edges, globalContext, stepOutputs, savedSlackProfiles };

      const executeNode = async (node: Node<CommandNodeData>) =>
        executeCommandNode(node, callbacks, graph);

      const branchResult = await runBranchingWorkflow(order, nodes, edges, {
        appendLog: appendSessionLog,
        updateNodeStatus,
        executeNode,
        checkpoint: () => control.checkpoint(),
      });

      runControllersRef.current.delete(sessionId);
      sessionRunMetaRef.current.delete(sessionId);

      if (branchResult.stopped) {
        stopRunSession(sessionId, { log: false });
        return;
      }

      if (!branchResult.ok) {
        if (control.isStopped()) {
          stopRunSession(sessionId, { log: false });
        } else {
          failRunSession(sessionId, groupId);
        }
        return;
      }

      appendSessionLog('success', '✓ Run complete.');
      finishRunSession(sessionId, groupId);
    },
    [
      appendToSession,
      edges,
      failRunSession,
      finishRunSession,
      getNodeIdsActiveInOtherSessions,
      nodes,
      resetNodeStatusForIds,
      stopRunSession,
      globalContext,
      savedSlackProfiles,
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

      const bounded = applyWorkflowBounds(order, nodes, edges, new Set(subsetNodeIds));
      if (bounded.error) {
        appendToSession(sessionId, 'error', `❌ ${bounded.error}`);
        failRunSession(sessionId, groupId);
        return;
      }

      const runOrder = bounded.order;

      const subsetNodes = nodes.filter((node) => subsetNodeIds.includes(node.id));
      const subsetEdges = edges.filter(
        (edge) => subsetNodeIds.includes(edge.source) && subsetNodeIds.includes(edge.target),
      );

      const control = new RunController();
      runControllersRef.current.set(sessionId, control);
      sessionRunMetaRef.current.set(sessionId, {
        groupId,
        nodeIds: runOrder.map((node) => node.id),
      });

      const scheduleGate = getEntryScheduleWait(subsetNodes, subsetEdges);
      if (scheduleGate && scheduleGate.waitMs > 0) {
        appendToSession(
          sessionId,
          'run',
          `⏰ ${label} scheduled for ${scheduleGate.targetLabel}. Waiting before run...`,
        );
        const waited = await waitDuration(
          scheduleGate.waitMs,
          (level, message) => appendToSession(sessionId, level, message),
          label,
          { control },
        );
        if (!waited) {
          stopRunSession(sessionId, { log: false });
          return;
        }
      }

      await runNodesInSession(sessionId, runOrder, label, groupId, control);
    },
    [appendToSession, edges, failRunSession, nodes, runNodesInSession, stopRunSession],
  );

  const runWorkflow = () => {
    const highlightedIds = expandRunSelection(selectedNodeIds, nodes, edges);
    const runSelection = highlightedIds.length > 0;
    const hasStart = canvasHasStartNode(nodes);

    // Start on canvas → always run full Start-scoped flow (ignore accidental node selection)
    const effectiveRunSelection = hasStart ? false : runSelection;

    const candidateNodes = effectiveRunSelection
      ? nodes.filter((node) => highlightedIds.includes(node.id))
      : nodes;
    const candidateIds = new Set(candidateNodes.map((node) => node.id));
    const candidateEdges = effectiveRunSelection
      ? edges.filter(
          (edge) => highlightedIds.includes(edge.source) && highlightedIds.includes(edge.target),
        )
      : edges;

    const { order, error } = effectiveRunSelection
      ? topologicalSortSubset(candidateNodes, candidateEdges, highlightedIds)
      : topologicalSort(candidateNodes, candidateEdges);
    if (error) {
      appendToActiveSession('error', `❌ ${error}`);
      return;
    }

    const bounded = applyWorkflowBounds(order, nodes, edges, candidateIds);
    if (bounded.error) {
      appendToActiveSession('error', `❌ ${bounded.error}`);
      return;
    }

    const runOrder = bounded.order;
    const startScope = getStartScopedNodeIds(nodes, edges, candidateIds);
    if (startScope) {
      markNodesOutsideScope(startScope, candidateIds, nodes, updateNodeStatus);
    }

    if (hasStart && runSelection) {
      appendToActiveSession(
        'system',
        'system: Start node on canvas — running from Start downstream (selection ignored).',
      );
    }

    const runNodes = candidateNodes;
    const runEdges = candidateEdges;

    const signature = effectiveRunSelection
      ? workflowSignature(highlightedIds, edges)
      : fullCanvasSignature(nodes, edges);
    const sessionName = effectiveRunSelection ? `Selected (${highlightedIds.length})` : 'Full Workflow';
    const { sessionId } = acquireRunSession(sessionName, signature);

    void (async () => {
      const control = new RunController();
      runControllersRef.current.set(sessionId, control);
      sessionRunMetaRef.current.set(sessionId, {
        nodeIds: runOrder.map((node) => node.id),
      });

      const scheduleGate = getEntryScheduleWait(runNodes, runEdges);
      if (scheduleGate && scheduleGate.waitMs > 0) {
        appendToSession(
          sessionId,
          'run',
          `⏰ Workflow scheduled for ${scheduleGate.targetLabel}. Waiting before run...`,
        );
        const waited = await waitDuration(
          scheduleGate.waitMs,
          (level, message) => appendToSession(sessionId, level, message),
          'Workflow schedule',
          { control },
        );
        if (!waited) {
          stopRunSession(sessionId, { log: false });
          return;
        }
      }

      const label = effectiveRunSelection
        ? `Running selected workflow (${runOrder.length} step${runOrder.length === 1 ? '' : 's'})`
        : 'Running workflow';
      await runNodesInSession(sessionId, runOrder, label, undefined, control);
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
      recordCanvasHistory();
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
    [appendToActiveSession, nodes, persistGroupHighlight, recordCanvasHistory, workflowGroups],
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
      recordCanvasHistory();
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
    [appendToActiveSession, applyGroupsToNodes, highlightedGroupId, recordCanvasHistory, setNodes, workflowGroups],
  );

  const handleDeleteGroupWithNodes = useCallback(
    (groupId: string) => {
      recordCanvasHistory();
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
    [appendToActiveSession, applyGroupsToNodes, highlightedGroupId, recordCanvasHistory, setEdges, setNodes, workflowGroups],
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
      const { sessionId } = acquireRunSession(
        group.name,
        signature,
      );

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

  const handleRenameTerminal = useCallback((sessionId: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;

    setTerminalSessions((prev) =>
      prev.map((session) => (session.id === sessionId ? { ...session, name: trimmed } : session)),
    );
  }, []);

  const hasRunningSessions = terminalSessions.some((session) => session.status === 'running');

  const currentProjectSnapshot = useMemo(
    () => projectPayloadSignature(nodes, edges, workflowGroups, savedContexts, savedSlackProfiles),
    [nodes, edges, workflowGroups, savedContexts, savedSlackProfiles],
  );

  const commandNodeCount = useMemo(
    () => nodes.filter((node) => !node.id.startsWith(GROUP_BACKGROUND_PREFIX)).length,
    [nodes],
  );

  const isWorkflowEmpty =
    commandNodeCount === 0 && edges.length === 0 && workflowGroups.length === 0;

  const isProjectDirty =
    !isWorkflowEmpty &&
    (savedProjectSnapshot === null || currentProjectSnapshot !== savedProjectSnapshot);
  const projectModalMode: ProjectModalMode =
    projectModal?.type === 'delete' ? 'delete' : projectModal?.type === 'edit' ? 'edit' : 'save';
  const projectModalTitle =
    projectModal?.type === 'delete'
      ? 'Delete Project'
      : projectModal?.type === 'edit'
        ? 'Rename Project'
        : 'Save Project';
  const projectModalDescription =
    projectModal?.type === 'delete'
      ? activeProjectId === projectModal.id
        ? 'Deletes saved project and clears the open canvas workflow.'
        : 'This removes the saved workflow from the database.'
      : projectModal?.type === 'edit'
        ? 'Change project name. Canvas content stays the same.'
        : 'Name this workflow project. Canvas, groups, and contexts will be stored.';
  const projectModalConfirmLabel =
    projectModal?.type === 'delete' ? 'Delete Project' : projectModal?.type === 'edit' ? 'Save Name' : 'Save Project';

  return (
    <div className="app">
      <ProjectModal
        open={projectModal !== null}
        mode={projectModalMode}
        title={projectModalTitle}
        description={projectModalDescription}
        error={modalError}
        value={projectModal?.type === 'delete' ? projectModal.name : modalName}
        confirmLabel={projectModalConfirmLabel}
        busy={projectActionBusy}
        danger={projectModal?.type === 'delete'}
        onChange={setModalName}
        onConfirm={() => void handleProjectModalConfirm()}
        onClose={() => {
          if (projectActionBusy) return;
          setProjectModal(null);
          setModalError('');
        }}
      />
      <header className="app__header">
        <div className="app__header-start">
          <div className="app__brand">
            <Layers size={22} />
            <div>
              <h1>Project:Genesis</h1>
              <p>Visual kubectl workflow builder</p>
            </div>
          </div>

          <div className="app__header-divider app__header-divider--start" aria-hidden="true" />

          <nav className="app__nav" aria-label="Project navigation">
            <WorkflowProjectsMenu
              activeProjectId={activeProjectId}
              activeProjectName={activeProjectName}
              isBusy={projectActionBusy || hasRunningSessions}
              refreshKey={projectsRefreshKey}
              onLoadProject={handleLoadProject}
              onNewProject={handleNewProject}
              onRequestEdit={(project) => {
                setModalName(project.name);
                setModalError('');
                setProjectModal({ type: 'edit', id: project.id, name: project.name });
              }}
              onRequestDelete={(project) => {
                setModalError('');
                setProjectModal({ type: 'delete', id: project.id, name: project.name });
              }}
            />
            <GlobalContextMenu
              contexts={savedContexts}
              activeContextName={globalContext}
              onAddContext={handleAddSavedContext}
              onUpdateContext={handleUpdateSavedContext}
              onDeleteContext={handleDeleteSavedContext}
              onToggleContext={handleToggleSavedContext}
            />
          </nav>
        </div>

        <div className="app__header-center">
          <div className="app__toolbar-group" role="group" aria-label="Edit actions">
            <button
              type="button"
              className="btn btn--ghost btn--icon"
              onClick={handleUndoCanvas}
              disabled={!canvasHistory.canUndo || hasRunningSessions}
              title="Undo (⌘Z)"
              aria-label="Undo"
            >
              <Undo2 size={16} />
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--icon"
              onClick={handleRedoCanvas}
              disabled={!canvasHistory.canRedo || hasRunningSessions}
              title="Redo (⌘⇧Z)"
              aria-label="Redo"
            >
              <Redo2 size={16} />
            </button>
          </div>

          <div className="app__header-divider" aria-hidden="true" />

          <div className="app__toolbar-group" role="group" aria-label="Workflow tools">
            <button
              type="button"
              className="btn btn--ghost btn--compact"
              onClick={() => void handleQuickSaveProject()}
              disabled={projectActionBusy || hasRunningSessions}
              title={
                activeProjectName
                  ? `Save "${activeProjectName}" (⌘S)`
                  : 'Save workflow project'
              }
            >
              <Save size={16} />
              <span className="btn__label">Save</span>
            </button>
            <WorkflowGroupMenu
              groups={workflowGroups}
              selectedNodeIds={selectedNodeIds}
              runningGroupIds={runningGroupIds}
              onSaveGroup={handleSaveGroup}
              onRunGroup={handleRunGroup}
              onDeleteGroup={handleDeleteGroup}
              onHighlightGroup={handleHighlightGroup}
            />
          </div>
        </div>

        <div className="app__header-end">
          <div className="app__panel-toggles" role="group" aria-label="Panel visibility">
            <button
              type="button"
              className="app__panel-toggle"
              onClick={() => setWorkloadsPanelOpen((open) => !open)}
              title={workloadsPanelOpen ? 'Hide command library' : 'Show command library'}
              aria-pressed={workloadsPanelOpen}
              aria-label="Command library panel"
            >
              {workloadsPanelOpen ? <PanelLeftClose size={16} /> : <Menu size={16} />}
              <span className="btn__label">Library</span>
            </button>
            <button
              type="button"
              className="app__panel-toggle"
              onClick={() => setConfigPanelOpen((open) => !open)}
              title={configPanelOpen ? 'Hide node inspector' : 'Show node inspector'}
              aria-pressed={configPanelOpen}
              aria-label="Node inspector panel"
            >
              {configPanelOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
              <span className="btn__label">Inspector</span>
            </button>
          </div>

          <div className="app__header-divider" aria-hidden="true" />

          <div className="app__toolbar-group" role="group" aria-label="App actions">
            <button
              type="button"
              className="btn btn--ghost btn--icon"
              onClick={() => setSettingsOpen(true)}
              title="Settings"
              aria-label="Settings"
            >
              <Settings size={16} />
            </button>
            <ToolbarOverflowMenu onClearCanvas={clearCanvas} clearDisabled={hasRunningSessions} />
          </div>

          <button
            type="button"
            className="btn btn--primary btn--run"
            onClick={runWorkflow}
            title={
              canvasHasStartNode(nodes)
                ? 'Run workflow from Start node downstream'
                : selectedNodeIds.length > 0
                  ? `Run highlighted workflow steps (${selectedNodeIds.length} selected)`
                  : 'Run full canvas workflow'
            }
          >
            <Play size={16} />
            <span className="btn__label">Run</span>
            {!canvasHasStartNode(nodes) && selectedNodeIds.length > 0 ? ` (${selectedNodeIds.length})` : ''}
          </button>
        </div>
      </header>

      <WorkflowStatusBar
        projectName={activeProjectName}
        globalContext={globalContext}
        nodeCount={commandNodeCount}
        edgeCount={edges.length}
        groupCount={workflowGroups.length}
        selectedCount={selectedNodeIds.length}
        isDirty={isProjectDirty}
        hasSavedProject={activeProjectId !== null}
      />

      <main
        className={[
          'app__workspace',
          !workloadsPanelOpen && 'app__workspace--workloads-hidden',
          !configPanelOpen && 'app__workspace--config-hidden',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {workloadsPanelOpen && <CommandPalette />}
        <FlowCanvas
          nodes={nodes}
          edges={edges}
          workflowGroups={workflowGroups}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          setNodes={setNodes}
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
          globalContext={globalContext}
          onConnect={handleConnect}
          onRecordHistory={recordCanvasHistory}
        />
        {configPanelOpen && (
          <NodeConfigurator
            node={selectedNode}
            inheritedContext={inheritedContext}
            inheritedNamespace={inheritedNamespace}
            globalContext={globalContext}
            savedSlackProfiles={savedSlackProfiles}
            nodes={nodes}
            edges={edges}
            onParamChange={handleParamChange}
            onCustomFieldAdd={handleCustomFieldAdd}
            onCustomFieldRemove={handleCustomFieldRemove}
            onYamlChange={handleYamlChange}
            onContextChange={handleContextChange}
          />
        )}
      </main>

      {settingsOpen && (
        <SettingsPage
          profiles={savedSlackProfiles}
          onAddProfile={handleAddSavedSlackProfile}
          onUpdateProfile={handleUpdateSavedSlackProfile}
          onDeleteProfile={handleDeleteSavedSlackProfile}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      <ExecutionTerminal
        sessions={terminalSessions}
        activeSessionId={activeTerminalId}
        onActiveSessionChange={setActiveTerminalId}
        onCloseSession={handleCloseTerminal}
        onClearSession={handleClearTerminal}
        onRenameSession={handleRenameTerminal}
        onPauseRun={handlePauseRun}
        onResumeRun={handleResumeRun}
        onStopRun={handleStopRun}
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
