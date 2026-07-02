package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
)

type WorkflowProject struct {
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Payload   json.RawMessage `json:"payload"`
	CreatedAt int64           `json:"createdAt"`
	UpdatedAt int64           `json:"updatedAt"`
}

type WorkflowProjectSummary struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	NodeCount  int    `json:"nodeCount"`
	EdgeCount  int    `json:"edgeCount"`
	GroupCount int    `json:"groupCount"`
	CreatedAt  int64  `json:"createdAt"`
	UpdatedAt  int64  `json:"updatedAt"`
}

type workflowPayloadMeta struct {
	Nodes          []json.RawMessage `json:"nodes"`
	Edges          []json.RawMessage `json:"edges"`
	WorkflowGroups []json.RawMessage `json:"workflowGroups"`
}

func payloadCounts(payload json.RawMessage) (nodes, edges, groups int) {
	var meta workflowPayloadMeta
	if err := json.Unmarshal(payload, &meta); err != nil {
		return 0, 0, 0
	}
	return len(meta.Nodes), len(meta.Edges), len(meta.WorkflowGroups)
}

func (s *Store) ListWorkflowProjects() ([]WorkflowProjectSummary, error) {
	rows, err := s.db.Query(`
		SELECT id, name, payload, created_at, updated_at
		FROM workflow_projects
		ORDER BY updated_at DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("list workflow projects: %w", err)
	}
	defer rows.Close()

	var projects []WorkflowProjectSummary
	for rows.Next() {
		var (
			item       WorkflowProjectSummary
			payloadStr string
		)
		if err := rows.Scan(&item.ID, &item.Name, &payloadStr, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan workflow project: %w", err)
		}
		item.NodeCount, item.EdgeCount, item.GroupCount = payloadCounts(json.RawMessage(payloadStr))
		projects = append(projects, item)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate workflow projects: %w", err)
	}

	if projects == nil {
		projects = []WorkflowProjectSummary{}
	}
	return projects, nil
}

func (s *Store) GetWorkflowProject(id string) (*WorkflowProject, error) {
	var (
		project    WorkflowProject
		payloadStr string
	)
	err := s.db.QueryRow(`
		SELECT id, name, payload, created_at, updated_at
		FROM workflow_projects
		WHERE id = ?
	`, id).Scan(&project.ID, &project.Name, &payloadStr, &project.CreatedAt, &project.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get workflow project: %w", err)
	}
	project.Payload = json.RawMessage(payloadStr)
	return &project, nil
}

func (s *Store) CreateWorkflowProject(name string, payload json.RawMessage) (*WorkflowProject, error) {
	now := time.Now().UnixMilli()
	project := WorkflowProject{
		ID:        uuid.NewString(),
		Name:      name,
		Payload:   payload,
		CreatedAt: now,
		UpdatedAt: now,
	}

	_, err := s.db.Exec(`
		INSERT INTO workflow_projects (id, name, payload, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?)
	`, project.ID, project.Name, string(project.Payload), project.CreatedAt, project.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("create workflow project: %w", err)
	}

	return &project, nil
}

func (s *Store) UpdateWorkflowProject(id, name string, payload json.RawMessage) (*WorkflowProject, error) {
	existing, err := s.GetWorkflowProject(id)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return nil, nil
	}

	updatedName := existing.Name
	if name != "" {
		updatedName = name
	}

	updatedPayload := existing.Payload
	if payload != nil {
		updatedPayload = payload
	}

	now := time.Now().UnixMilli()
	_, err = s.db.Exec(`
		UPDATE workflow_projects
		SET name = ?, payload = ?, updated_at = ?
		WHERE id = ?
	`, updatedName, string(updatedPayload), now, id)
	if err != nil {
		return nil, fmt.Errorf("update workflow project: %w", err)
	}

	return &WorkflowProject{
		ID:        id,
		Name:      updatedName,
		Payload:   updatedPayload,
		CreatedAt: existing.CreatedAt,
		UpdatedAt: now,
	}, nil
}

func (s *Store) DeleteWorkflowProject(id string) (bool, error) {
	result, err := s.db.Exec(`DELETE FROM workflow_projects WHERE id = ?`, id)
	if err != nil {
		return false, fmt.Errorf("delete workflow project: %w", err)
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("delete workflow project rows: %w", err)
	}
	return rows > 0, nil
}
