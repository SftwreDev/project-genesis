package store

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type RunLogLine struct {
	Level   string `json:"level"`
	Message string `json:"message"`
}

type RunLogFile struct {
	File     string `json:"file"`
	Path     string `json:"path"`
	Modified int64  `json:"modified"`
}

func logsRootDir() string {
	if dir := strings.TrimSpace(os.Getenv("GENESIS_DATA_DIR")); dir != "" {
		return filepath.Join(dir, "logs")
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return "logs"
	}
	return filepath.Join(home, ".genesis", "logs")
}

func LogsRootDir() string {
	return logsRootDir()
}

func sanitizeLogSlug(name string) string {
	name = strings.ToLower(strings.TrimSpace(name))
	if name == "" {
		return "untitled"
	}

	var b strings.Builder
	lastHyphen := false
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			lastHyphen = false
		case r == ' ', r == '_', r == '-', r == '.':
			if !lastHyphen && b.Len() > 0 {
				b.WriteRune('-')
				lastHyphen = true
			}
		default:
			if !lastHyphen && b.Len() > 0 {
				b.WriteRune('-')
				lastHyphen = true
			}
		}
	}

	result := strings.Trim(b.String(), "-")
	if result == "" {
		return "untitled"
	}
	return result
}

func BuildRunLogFilename(name string) string {
	slug := sanitizeLogSlug(name)
	stamp := time.Now().Format("2006-01-02_15-04-05")
	return fmt.Sprintf("%s-%s.txt", slug, stamp)
}

func validateLogFilename(filename string) error {
	filename = strings.TrimSpace(filename)
	if filename == "" {
		return fmt.Errorf("invalid log filename")
	}
	if strings.Contains(filename, "/") || strings.Contains(filename, "\\") || strings.Contains(filename, "..") {
		return fmt.Errorf("invalid log filename")
	}
	if !strings.HasSuffix(strings.ToLower(filename), ".txt") {
		return fmt.Errorf("invalid log filename")
	}
	return nil
}

func UpsertRunLogs(name string, lines []RunLogLine, existingFile string) (string, error) {
	root := logsRootDir()
	if err := os.MkdirAll(root, 0o755); err != nil {
		return "", fmt.Errorf("create logs dir: %w", err)
	}

	filename := strings.TrimSpace(existingFile)
	if filename != "" {
		if err := validateLogFilename(filename); err != nil {
			return "", err
		}
	} else {
		filename = BuildRunLogFilename(name)
	}

	target := filepath.Join(root, filename)
	content := formatRunLogFile(name, lines)

	if err := os.WriteFile(target, []byte(content), 0o644); err != nil {
		return "", fmt.Errorf("write log file: %w", err)
	}

	return filename, nil
}

func formatLevelLabel(level string) string {
	switch strings.ToLower(strings.TrimSpace(level)) {
	case "system":
		return "SYS "
	case "run":
		return "RUN "
	case "success":
		return " OK "
	case "error":
		return " ERR"
	case "output":
		return " OUT"
	case "warn":
		return "WARN"
	default:
		return "LOG "
	}
}

func isOutputSectionHeader(message string) bool {
	trimmed := strings.TrimSpace(message)
	return strings.HasPrefix(trimmed, "──") && strings.HasSuffix(trimmed, "──")
}

func formatRunLogFile(name string, lines []RunLogLine) string {
	updatedAt := time.Now().Format("2006-01-02 15:04:05")
	var b strings.Builder

	b.WriteString("═══════════════════════════════════════════════════════════════\n")
	b.WriteString("  Project:Genesis — Run Log\n")
	b.WriteString("═══════════════════════════════════════════════════════════════\n")
	b.WriteString(fmt.Sprintf("  Session : %s\n", name))
	b.WriteString(fmt.Sprintf("  Updated : %s\n", updatedAt))
	b.WriteString(fmt.Sprintf("  Lines   : %d\n", len(lines)))
	b.WriteString("───────────────────────────────────────────────────────────────\n\n")

	inOutputBlock := false
	for _, line := range lines {
		level := strings.ToLower(strings.TrimSpace(line.Level))
		message := line.Message

		if level == "output" && isOutputSectionHeader(message) {
			inOutputBlock = true
			b.WriteString(fmt.Sprintf("[%s] %s\n", formatLevelLabel(level), message))
			continue
		}

		if level != "output" {
			inOutputBlock = false
		}

		if inOutputBlock && level == "output" {
			b.WriteString(fmt.Sprintf("         %s\n", message))
			continue
		}

		b.WriteString(fmt.Sprintf("[%s] %s\n", formatLevelLabel(level), message))
	}

	b.WriteString("\n───────────────────────────────────────────────────────────────\n")
	b.WriteString("  End of log\n")
	return b.String()
}

func appendRunLogFile(files *[]RunLogFile, filename string, modified int64) {
	*files = append(*files, RunLogFile{
		File:     filename,
		Path:     filename,
		Modified: modified,
	})
}

func ListRunLogFiles() ([]RunLogFile, error) {
	root := logsRootDir()
	if err := os.MkdirAll(root, 0o755); err != nil {
		return nil, fmt.Errorf("create logs root: %w", err)
	}

	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, fmt.Errorf("read logs root: %w", err)
	}

	files := make([]RunLogFile, 0)
	for _, entry := range entries {
		if entry.IsDir() {
			groupFiles, err := os.ReadDir(filepath.Join(root, entry.Name()))
			if err != nil {
				continue
			}
			for _, fileEntry := range groupFiles {
				if fileEntry.IsDir() || !strings.HasSuffix(strings.ToLower(fileEntry.Name()), ".txt") {
					continue
				}
				info, err := fileEntry.Info()
				if err != nil {
					continue
				}
				legacyName := filepath.ToSlash(filepath.Join(entry.Name(), fileEntry.Name()))
				appendRunLogFile(&files, legacyName, info.ModTime().Unix())
			}
			continue
		}

		if !strings.HasSuffix(strings.ToLower(entry.Name()), ".txt") {
			continue
		}

		info, err := entry.Info()
		if err != nil {
			continue
		}
		appendRunLogFile(&files, entry.Name(), info.ModTime().Unix())
	}

	sort.Slice(files, func(i, j int) bool {
		if files[i].Modified == files[j].Modified {
			return files[i].File > files[j].File
		}
		return files[i].Modified > files[j].Modified
	})

	return files, nil
}

func ResolveRunLogFile(filename string) (string, error) {
	if err := validateLogFilename(filename); err != nil {
		return "", err
	}

	root := logsRootDir()
	target := filepath.Join(root, filename)
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	absTarget, err := filepath.Abs(target)
	if err != nil {
		return "", err
	}
	if !strings.HasPrefix(absTarget, absRoot+string(os.PathSeparator)) && absTarget != absRoot {
		return "", fmt.Errorf("invalid log path")
	}

	return absTarget, nil
}

func ResolveRunLogPath(relativePath string) (string, error) {
	relativePath = filepath.ToSlash(strings.TrimSpace(relativePath))
	if relativePath == "" || strings.Contains(relativePath, "..") {
		return "", fmt.Errorf("invalid log path")
	}

	parts := strings.Split(relativePath, "/")
	for _, part := range parts {
		if part == "" || part == "." {
			return "", fmt.Errorf("invalid log path")
		}
		if !strings.HasSuffix(strings.ToLower(part), ".txt") {
			return "", fmt.Errorf("invalid log path")
		}
	}

	root := logsRootDir()
	target := filepath.Join(root, filepath.FromSlash(relativePath))
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	absTarget, err := filepath.Abs(target)
	if err != nil {
		return "", err
	}
	if !strings.HasPrefix(absTarget, absRoot+string(os.PathSeparator)) && absTarget != absRoot {
		return "", fmt.Errorf("invalid log path")
	}

	return absTarget, nil
}

func DeleteRunLog(relativePath string) error {
	target, err := ResolveRunLogPath(relativePath)
	if err != nil {
		return err
	}

	if err := os.Remove(target); err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("log file not found")
		}
		return fmt.Errorf("delete log file: %w", err)
	}

	return nil
}

func normalizeRenameTarget(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", fmt.Errorf("filename is required")
	}
	if strings.Contains(name, "/") || strings.Contains(name, "\\") || strings.Contains(name, "..") {
		return "", fmt.Errorf("invalid filename")
	}
	if !strings.HasSuffix(strings.ToLower(name), ".txt") {
		name += ".txt"
	}
	if err := validateLogFilename(name); err != nil {
		return "", err
	}
	return name, nil
}

func RenameRunLog(fromPath, toName string) (string, error) {
	oldTarget, err := ResolveRunLogPath(fromPath)
	if err != nil {
		return "", err
	}

	newBase, err := normalizeRenameTarget(toName)
	if err != nil {
		return "", err
	}

	newTarget := filepath.Join(filepath.Dir(oldTarget), newBase)
	if _, err := os.Stat(newTarget); err == nil {
		return "", fmt.Errorf("a log file with that name already exists")
	} else if err != nil && !os.IsNotExist(err) {
		return "", fmt.Errorf("check target file: %w", err)
	}

	if err := os.Rename(oldTarget, newTarget); err != nil {
		return "", fmt.Errorf("rename log file: %w", err)
	}

	if strings.Contains(fromPath, "/") {
		return filepath.ToSlash(filepath.Join(filepath.Dir(filepath.FromSlash(fromPath)), newBase)), nil
	}
	return newBase, nil
}
