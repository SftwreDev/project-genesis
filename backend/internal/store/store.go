package store

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

type Store struct {
	db *sql.DB
}

// databasePath returns the path to the database file.
// It first checks the GENESIS_DB_PATH environment variable, 
// then the GENESIS_DATA_DIR environment variable,
// and finally the home directory.
// If none of these are set, it returns the default path "genesis.db".
// The default path is "~/.genesis/genesis.db".
func databasePath() string {
	if path := strings.TrimSpace(os.Getenv("GENESIS_DB_PATH")); path != "" {
		return path
	}

	if dir := strings.TrimSpace(os.Getenv("GENESIS_DATA_DIR")); dir != "" {
		return filepath.Join(dir, "genesis.db")
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return "genesis.db"
	}
	return filepath.Join(home, ".genesis", "genesis.db")
}

// Open opens a new database connection and performs necessary migrations.
// It first creates the data directory if it doesn't exist,
// then opens the database file with the appropriate connection settings.
// If the database file doesn't exist, it creates it.
// If the database file is corrupted, it returns an error.
// If the database file is not a valid SQLite database, it returns an error.
func Open() (*Store, error) {
	path := databasePath()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, fmt.Errorf("create data dir: %w", err)
	}

	dsn := fmt.Sprintf("file:%s?_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)", path)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}

	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	db.SetConnMaxLifetime(30 * time.Minute)

	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("ping sqlite: %w", err)
	}

	store := &Store{db: db}
	if err := store.migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}

	return store, nil
}

func (s *Store) Close() error {
	if s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *Store) migrate() error {
	_, err := s.db.Exec(`
		CREATE TABLE IF NOT EXISTS workflow_projects (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			payload TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_workflow_projects_updated
			ON workflow_projects(updated_at DESC);
	`)
	if err != nil {
		return fmt.Errorf("migrate workflow_projects: %w", err)
	}
	return nil
}
