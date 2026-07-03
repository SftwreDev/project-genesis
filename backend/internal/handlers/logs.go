package handlers

import (
	"encoding/json"
	"fmt"
	"html"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gorilla/mux"
	"project-genesis/internal/store"
)

type LogsHandler struct{}

type saveRunLogsRequest struct {
	Name string             `json:"name"`
	Logs []store.RunLogLine `json:"logs"`
	File string             `json:"file"`
}

type saveRunLogsResponse struct {
	File string `json:"file"`
	Path string `json:"path"`
	Root string `json:"root"`
}

type renameRunLogRequest struct {
	From string `json:"from"`
	To   string `json:"to"`
}

type renameRunLogResponse struct {
	File string `json:"file"`
	Path string `json:"path"`
}

const logsPageStyles = `
body{margin:0;background:#020617;color:#e2e8f0;font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace}
.wrap{max-width:1080px;margin:0 auto;padding:24px}
h1{font-size:1.15rem;font-weight:600;margin:0 0 6px}
.meta{color:#64748b;font-size:.82rem;margin-bottom:18px}
.toolbar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px}
.btn{display:inline-flex;align-items:center;gap:6px;border:1px solid rgba(148,163,184,.18);background:rgba(30,41,59,.85);color:#e2e8f0;border-radius:8px;padding:6px 10px;font:inherit;font-size:.78rem;cursor:pointer;text-decoration:none}
.btn:hover{border-color:rgba(56,189,248,.35);color:#fff}
.btn--danger{border-color:rgba(248,113,113,.35);color:#fca5a5}
.btn--danger:hover{border-color:rgba(248,113,113,.65);background:rgba(127,29,29,.25)}
.table{width:100%;border-collapse:collapse}
.table th,.table td{padding:10px 12px;border-bottom:1px solid rgba(148,163,184,.12);text-align:left;vertical-align:middle}
.table th{color:#94a3b8;font-size:.74rem;text-transform:uppercase;letter-spacing:.04em}
.file-name{color:#e2e8f0;font-weight:600;word-break:break-all}
.actions{display:flex;gap:6px;flex-wrap:wrap}
.search-bar{display:flex;align-items:center;gap:10px;margin-bottom:16px}
.search-input{flex:1;min-width:220px;border:1px solid rgba(148,163,184,.18);background:rgba(15,23,42,.85);color:#e2e8f0;border-radius:8px;padding:8px 12px;font:inherit}
.search-input:focus{outline:none;border-color:rgba(56,189,248,.45)}
.search-meta{color:#64748b;font-size:.78rem;white-space:nowrap}
.table-row--hidden{display:none}
.empty{color:#64748b;padding:16px 0}
.log-view{background:rgba(2,6,23,.92);border:1px solid rgba(148,163,184,.12);border-radius:12px;padding:16px;overflow:auto;max-height:72vh}
.log-line{white-space:pre-wrap;word-break:break-word;padding:1px 0}
.log-line--header{color:#7dd3fc}
.log-line--divider{color:#475569}
.log-line--sys{color:#94a3b8}
.log-line--run{color:#c4b5fd}
.log-line--ok{color:#86efac}
.log-line--err{color:#fca5a5}
.log-line--warn{color:#fcd34d}
.log-line--out{color:#cbd5e1}
.log-line--indent{color:#cbd5e1;padding-left:18px}
`

func logFileURL(path string) string {
	return "/api/logs/view/" + url.PathEscape(path)
}

func logDownloadURL(path string) string {
	return "/api/logs/download/" + url.PathEscape(path)
}

func logLineClass(line string) string {
	trimmed := strings.TrimSpace(line)
	switch {
	case strings.HasPrefix(trimmed, "════"), strings.HasPrefix(trimmed, "  Project:Genesis"):
		return "log-line log-line--header"
	case strings.HasPrefix(trimmed, "────"), strings.HasPrefix(trimmed, "  End of log"):
		return "log-line log-line--divider"
	case strings.HasPrefix(trimmed, "  Session"), strings.HasPrefix(trimmed, "  Updated"), strings.HasPrefix(trimmed, "  Lines"):
		return "log-line log-line--sys"
	case strings.HasPrefix(trimmed, "[SYS]"), strings.HasPrefix(trimmed, "[SYS ]"):
		return "log-line log-line--sys"
	case strings.HasPrefix(trimmed, "[RUN]"):
		return "log-line log-line--run"
	case strings.HasPrefix(trimmed, "[ OK]"):
		return "log-line log-line--ok"
	case strings.HasPrefix(trimmed, "[ ERR]"):
		return "log-line log-line--err"
	case strings.HasPrefix(trimmed, "[WARN]"):
		return "log-line log-line--warn"
	case strings.HasPrefix(trimmed, "[ OUT]"):
		return "log-line log-line--out"
	case strings.HasPrefix(trimmed, "         "):
		return "log-line log-line--indent"
	default:
		return "log-line"
	}
}

func renderLogContentHTML(content string) string {
	var b strings.Builder
	for _, line := range strings.Split(content, "\n") {
		b.WriteString(`<div class="`)
		b.WriteString(logLineClass(line))
		b.WriteString(`">`)
		if line == "" {
			b.WriteString(" ")
		} else {
			b.WriteString(html.EscapeString(line))
		}
		b.WriteString("</div>")
	}
	return b.String()
}

func (h *LogsHandler) SaveRunLogs(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	var req saveRunLogsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(CommandResponse{Error: "invalid request body"})
		return
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(CommandResponse{Error: "name is required"})
		return
	}

	filename, err := store.UpsertRunLogs(name, req.Logs, req.File)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(CommandResponse{Error: err.Error()})
		return
	}

	json.NewEncoder(w).Encode(saveRunLogsResponse{
		File: filename,
		Path: filename,
		Root: store.LogsRootDir(),
	})
}

func (h *LogsHandler) ListRunLogs(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	files, err := store.ListRunLogFiles()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(CommandResponse{Error: err.Error()})
		return
	}

	json.NewEncoder(w).Encode(map[string]any{
		"root":  store.LogsRootDir(),
		"files": files,
	})
}

func (h *LogsHandler) ViewRunLog(w http.ResponseWriter, r *http.Request) {
	filename, err := url.PathUnescape(mux.Vars(r)["file"])
	if err != nil {
		http.Error(w, "Log file not found", http.StatusNotFound)
		return
	}

	target, err := store.ResolveRunLogPath(filename)
	if err != nil {
		http.Error(w, "Log file not found", http.StatusNotFound)
		return
	}

	content, err := os.ReadFile(target)
	if err != nil {
		http.Error(w, "Log file not found", http.StatusNotFound)
		return
	}

	if r.URL.Query().Get("raw") == "1" {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Write(content)
		return
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	var b strings.Builder
	b.WriteString("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">")
	b.WriteString("<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">")
	b.WriteString("<title>")
	b.WriteString(html.EscapeString(filepath.Base(filename)))
	b.WriteString(" — Project:Genesis</title><style>")
	b.WriteString(logsPageStyles)
	b.WriteString("</style></head><body><div class=\"wrap\">")
	b.WriteString("<h1>")
	b.WriteString(html.EscapeString(filepath.Base(filename)))
	b.WriteString("</h1>")
	b.WriteString("<div class=\"meta\">")
	b.WriteString(html.EscapeString(filename))
	b.WriteString("</div>")
	b.WriteString("<div class=\"toolbar\">")
	b.WriteString("<a class=\"btn\" href=\"/api/logs/browser\">← Logs folder</a>")
	b.WriteString("<a class=\"btn\" href=\"")
	b.WriteString(html.EscapeString(logDownloadURL(filename)))
	b.WriteString("\">Download</a>")
	b.WriteString("<button class=\"btn\" type=\"button\" onclick=\"renameLog('")
	b.WriteString(html.EscapeString(filename))
	b.WriteString("')\">Rename</button>")
	b.WriteString("<button class=\"btn btn--danger\" type=\"button\" onclick=\"deleteLog('")
	b.WriteString(html.EscapeString(filename))
	b.WriteString("')\">Delete</button>")
	b.WriteString("</div>")
	b.WriteString("<div class=\"log-view\">")
	b.WriteString(renderLogContentHTML(string(content)))
	b.WriteString("</div>")
	b.WriteString(`<script>
async function renameLog(path){
  const current=path.split('/').pop();
  const next=prompt('Rename log file to:', current);
  if(!next||next.trim()===current)return;
  const res=await fetch('/api/logs/rename',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({from:path,to:next.trim()})});
  const payload=await res.json().catch(()=>({}));
  if(!res.ok){alert(payload.error||'Could not rename log');return;}
  window.location.href='/api/logs/view/'+encodeURIComponent(payload.path);
}
async function deleteLog(path){
  if(!confirm('Delete '+path+'?'))return;
  const res=await fetch('/api/logs/file/'+encodeURIComponent(path),{method:'DELETE'});
  const payload=await res.json().catch(()=>({}));
  if(!res.ok){alert(payload.error||'Could not delete log');return;}
  window.location.href='/api/logs/browser';
}
</script>`)
	b.WriteString("</div></body></html>")
	w.Write([]byte(b.String()))
}

func (h *LogsHandler) DownloadRunLog(w http.ResponseWriter, r *http.Request) {
	filename, err := url.PathUnescape(mux.Vars(r)["file"])
	if err != nil {
		http.Error(w, "Log file not found", http.StatusNotFound)
		return
	}

	target, err := store.ResolveRunLogPath(filename)
	if err != nil {
		http.Error(w, "Log file not found", http.StatusNotFound)
		return
	}

	content, err := os.ReadFile(target)
	if err != nil {
		http.Error(w, "Log file not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filepath.Base(target)))
	w.Write(content)
}

func (h *LogsHandler) DeleteRunLog(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	filename, err := url.PathUnescape(mux.Vars(r)["file"])
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(CommandResponse{Error: "invalid log path"})
		return
	}

	if err := store.DeleteRunLog(filename); err != nil {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(CommandResponse{Error: err.Error()})
		return
	}

	json.NewEncoder(w).Encode(map[string]string{"status": "deleted"})
}

func (h *LogsHandler) RenameRunLog(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	var req renameRunLogRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(CommandResponse{Error: "invalid request body"})
		return
	}

	from := strings.TrimSpace(req.From)
	to := strings.TrimSpace(req.To)
	if from == "" || to == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(CommandResponse{Error: "from and to are required"})
		return
	}

	newPath, err := store.RenameRunLog(from, to)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(CommandResponse{Error: err.Error()})
		return
	}

	json.NewEncoder(w).Encode(renameRunLogResponse{
		File: filepath.Base(newPath),
		Path: newPath,
	})
}

func (h *LogsHandler) BrowseRunLogs(w http.ResponseWriter, r *http.Request) {
	files, err := store.ListRunLogFiles()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")

	var b strings.Builder
	b.WriteString("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">")
	b.WriteString("<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">")
	b.WriteString("<title>Project:Genesis — Saved Logs</title><style>")
	b.WriteString(logsPageStyles)
	b.WriteString("</style></head><body><div class=\"wrap\">")
	b.WriteString("<h1>Saved run logs</h1>")
	b.WriteString("<div class=\"meta\">Root: ")
	b.WriteString(html.EscapeString(store.LogsRootDir()))
	b.WriteString("</div>")

	if len(files) == 0 {
		b.WriteString("<p class=\"empty\">No saved logs yet. Turn on <strong>Save</strong> on a terminal tab to capture live logs.</p>")
	} else {
		b.WriteString(`<div class="search-bar">
<input id="log-search" class="search-input" type="search" placeholder="Search log files..." autocomplete="off" />
<span id="log-search-meta" class="search-meta"></span>
</div>`)
		b.WriteString(`<table class="table"><thead><tr><th>File</th><th>Updated</th><th>Actions</th></tr></thead><tbody id="log-table-body">`)
		for _, file := range files {
			modified := time.Unix(file.Modified, 0).Format("2006-01-02 15:04:05")
			b.WriteString("<tr class=\"log-row\" data-search=\"")
			b.WriteString(html.EscapeString(strings.ToLower(file.File + " " + modified)))
			b.WriteString("\"><td class=\"file-name\">")
			b.WriteString(html.EscapeString(file.File))
			b.WriteString("</td><td class=\"meta\">")
			b.WriteString(html.EscapeString(modified))
			b.WriteString("</td><td><div class=\"actions\">")
			b.WriteString("<a class=\"btn\" href=\"")
			b.WriteString(html.EscapeString(logFileURL(file.Path)))
			b.WriteString("\" target=\"_blank\" rel=\"noopener\">View</a>")
			b.WriteString("<a class=\"btn\" href=\"")
			b.WriteString(html.EscapeString(logDownloadURL(file.Path)))
			b.WriteString("\">Download</a>")
			b.WriteString("<button class=\"btn btn--danger\" type=\"button\" onclick=\"deleteLog('")
			b.WriteString(html.EscapeString(file.Path))
			b.WriteString("')\">Delete</button>")
			b.WriteString("</div></td></tr>")
		}
		b.WriteString("</tbody></table>")
		b.WriteString(`<p id="log-search-empty" class="empty table-row--hidden">No log files match your search.</p>`)
	}

	b.WriteString(`<script>
function filterLogRows(){
  const input=document.getElementById('log-search');
  const rows=[...document.querySelectorAll('.log-row')];
  const empty=document.getElementById('log-search-empty');
  const meta=document.getElementById('log-search-meta');
  if(!input||rows.length===0)return;
  const needle=input.value.trim().toLowerCase();
  let visible=0;
  for(const row of rows){
    const haystack=row.getAttribute('data-search')||'';
    const match=!needle||haystack.includes(needle);
    row.classList.toggle('table-row--hidden',!match);
    if(match)visible++;
  }
  if(meta)meta.textContent=needle?visible+' / '+rows.length+' shown':'';
  if(empty)empty.classList.toggle('table-row--hidden',!needle||visible>0);
}
const searchInput=document.getElementById('log-search');
if(searchInput){
  searchInput.addEventListener('input',filterLogRows);
  filterLogRows();
}
async function deleteLog(path){
  if(!confirm('Delete '+path+'?'))return;
  const res=await fetch('/api/logs/file/'+encodeURIComponent(path),{method:'DELETE'});
  const payload=await res.json().catch(()=>({}));
  if(!res.ok){alert(payload.error||'Could not delete log');return;}
  location.reload();
}
</script>`)
	b.WriteString("</div></body></html>")
	w.Write([]byte(b.String()))
}
