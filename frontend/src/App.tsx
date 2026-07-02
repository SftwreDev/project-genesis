import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  addEdge,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react';
import { Layers, Menu, PanelLeftClose, PanelRightClose, PanelRightOpen, Play, Save, Trash2 } from 'lucide-react';
import CommandPalette from './components/CommandPalette';
import ExecutionTerminal from './components/ExecutionTerminal';
import FlowCanvas from './components/FlowCanvas';
import NodeConfigurator from './components/NodeConfigurator';
import WorkflowGroupMenu from './components/WorkflowGroupMenu';
import GlobalContextMenu from './components/GlobalContextMenu';
import type { CommandNodeData, SavedKubeContext, TerminalLog, TerminalSession, WorkflowGroup, WorkflowGroupFrame } from './types';
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
import {
  fullCanvasSignature,
  groupSignature,
  singleNodeSignature,
  workflowSignature,
  estimateGroupBounds,
  clampGroupFrame,
} from './utils/workflowSignature';
import { isWorkflowTool } from './data/k8sCommands';
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
  renameWorkflowProject,
  updateWorkflowProject,
} from './utils/workflowProjects';
import WorkflowProjectsMenu from './components/WorkflowProjectsMenu';
import ProjectModal, { type ProjectModalMode } from './components/ProjectModal';
import {
  createSavedContext,
  getActiveGlobalContext,
  loadSavedContexts,
  persistSavedContexts,
} from './utils/savedContexts';
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
  const [configPanelOpen, setConfigPanelOpen] = useState(true);
  const [workloadsPanelOpen, setWorkloadsPanelOpen] = useState(true);
  const [workflowGroups, setWorkflowGroups] = useState<WorkflowGroup[]>([]);
  const [runningGroupIds, setRunningGroupIds] = useState<Set<string>>(new Set());
  const [highlightedGroupId, setHighlightedGroupId] = useState<string | null>(null);
  const [terminalSessions, setTerminalSessions] = useState<TerminalSession[]>([initialSession]);
  const [activeTerminalId, setActiveTerminalId] = useState(initialSession.id);
  const [terminalHeight, setTerminalHeight] = useState(220);
  const [savedContexts, setSavedContexts] = useState<SavedKubeContext[]>(() => loadSavedContexts());
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeProjectName, setActiveProjectName] = useState<string | null>(null);
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
      if (!connection.target) return;

      setEdges((eds) => {
        const nextEdges = addEdge({ ...connection, animated: true }, eds);
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
    [globalContext, setEdges, setNodes],
  );

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

  const resetCanvasWorkflow = useCallback(
    (options?: { clearActiveProject?: boolean; logMessage?: string }) => {
      setNodes([]);
      setEdges([]);
      setSelectedNode(null);
      setSelectedNodeIds([]);
      setWorkflowGroups([]);
      setHighlightedGroupId(null);
      if (options?.clearActiveProject !== false) {
        setActiveProjectId(null);
        setActiveProjectName(null);
      }
      if (options?.logMessage) {
        appendToActiveSession('system', options.logMessage);
      }
    },
    [appendToActiveSession, setEdges, setNodes],
  );

  const clearCanvas = () => {
    resetCanvasWorkflow({ logMessage: 'system: Canvas cleared.' });
  };

  const saveProjectCore = useCallback(
    async (name: string, saveAsNew: boolean) => {
      const payload = buildWorkflowProjectPayload(nodes, edges, workflowGroups, savedContexts);
      if (saveAsNew || !activeProjectId) {
        const project = await createWorkflowProject(name, payload);
        setActiveProjectId(project.id);
        setActiveProjectName(project.name);
        appendToActiveSession('system', `system: Saved project "${project.name}".`);
        return;
      }

      const project = await updateWorkflowProject(activeProjectId, name, payload);
      setActiveProjectName(project.name);
      appendToActiveSession('system', `system: Updated project "${project.name}".`);
    },
    [activeProjectId, appendToActiveSession, edges, nodes, savedContexts, workflowGroups],
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
        setActiveProjectId(project.id);
        setActiveProjectName(project.name);
        setSelectedNode(null);
        setSelectedNodeIds([]);
        setHighlightedGroupId(null);
        appendToActiveSession('system', `system: Loaded project "${project.name}".`);
      } finally {
        setProjectActionBusy(false);
      }
    },
    [appendToActiveSession, applyGroupsToNodes, savedContexts, setEdges, setNodes],
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

      const graph = { nodes, edges, globalContext };

      for (const node of order) {
        if (!(await control.checkpoint())) {
          stopRunSession(sessionId, { log: false });
          return;
        }

        const ok = await executeCommandNode(node, callbacks, graph);
        if (!ok) {
          runControllersRef.current.delete(sessionId);
          sessionRunMetaRef.current.delete(sessionId);
          if (control.isStopped()) {
            stopRunSession(sessionId, { log: false });
          } else {
            failRunSession(sessionId, groupId);
          }
          return;
        }
      }

      runControllersRef.current.delete(sessionId);
      sessionRunMetaRef.current.delete(sessionId);
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

      const control = new RunController();
      runControllersRef.current.set(sessionId, control);
      sessionRunMetaRef.current.set(sessionId, {
        groupId,
        nodeIds: order.map((node) => node.id),
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

      await runNodesInSession(sessionId, order, label, groupId, control);
    },
    [appendToSession, edges, failRunSession, nodes, runNodesInSession, stopRunSession],
  );

  const runWorkflow = () => {
    const highlightedIds = expandRunSelection(selectedNodeIds, nodes, edges);
    const runSelection = highlightedIds.length > 0;

    const { order, error } = runSelection
      ? topologicalSortSubset(nodes, edges, highlightedIds)
      : topologicalSort(nodes, edges);
    if (error) {
      appendToActiveSession('error', `❌ ${error}`);
      return;
    }

    const runNodes = runSelection ? nodes.filter((node) => highlightedIds.includes(node.id)) : nodes;
    const runEdges = runSelection
      ? edges.filter(
          (edge) => highlightedIds.includes(edge.source) && highlightedIds.includes(edge.target),
        )
      : edges;

    const signature = runSelection
      ? workflowSignature(highlightedIds, edges)
      : fullCanvasSignature(nodes, edges);
    const sessionName = runSelection ? `Selected (${highlightedIds.length})` : 'Full Workflow';
    const { sessionId } = acquireRunSession(sessionName, signature);

    void (async () => {
      const control = new RunController();
      runControllersRef.current.set(sessionId, control);
      sessionRunMetaRef.current.set(sessionId, {
        nodeIds: order.map((node) => node.id),
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

      const label = runSelection
        ? `Running selected workflow (${order.length} step${order.length === 1 ? '' : 's'})`
        : 'Running workflow';
      await runNodesInSession(sessionId, order, label, undefined, control);
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
        <div className="app__brand">
          <Layers size={22} />
          <div>
            <h1>Project:Genesis</h1>
            <p>Visual kubectl workflow builder</p>
          </div>
        </div>
        <div className="app__actions">
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
          <WorkflowGroupMenu
            groups={workflowGroups}
            selectedNodeIds={selectedNodeIds}
            runningGroupIds={runningGroupIds}
            onSaveGroup={handleSaveGroup}
            onRunGroup={handleRunGroup}
            onDeleteGroup={handleDeleteGroup}
            onHighlightGroup={handleHighlightGroup}
          />
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => void handleQuickSaveProject()}
            disabled={projectActionBusy || hasRunningSessions}
            title={
              activeProjectName
                ? `Update "${activeProjectName}"`
                : 'Save workflow project'
            }
          >
            <Save size={16} />
            Save
          </button>
          <button type="button" className="btn btn--ghost" onClick={clearCanvas} disabled={hasRunningSessions}>
            <Trash2 size={16} />
            Clear Canvas
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => setWorkloadsPanelOpen((open) => !open)}
            title={workloadsPanelOpen ? 'Hide workloads library' : 'Show workloads library'}
            aria-pressed={workloadsPanelOpen}
          >
            {workloadsPanelOpen ? <PanelLeftClose size={16} /> : <Menu size={16} />}
            Workloads
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => setConfigPanelOpen((open) => !open)}
            title={configPanelOpen ? 'Hide config panel' : 'Show config panel'}
            aria-pressed={configPanelOpen}
          >
            {configPanelOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
            Panel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={runWorkflow}
            title={
              selectedNodeIds.length > 0
                ? `Run highlighted workflow steps (${selectedNodeIds.length} selected)`
                : 'Run full canvas workflow'
            }
          >
            <Play size={16} />
            Run Workflow{selectedNodeIds.length > 0 ? ` (${selectedNodeIds.length})` : ''}
          </button>
        </div>
      </header>

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
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
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
        />
        {configPanelOpen && (
          <NodeConfigurator
            node={selectedNode}
            inheritedContext={inheritedContext}
            inheritedNamespace={inheritedNamespace}
            globalContext={globalContext}
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
