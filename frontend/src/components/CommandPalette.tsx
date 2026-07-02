import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, GripVertical, Search } from 'lucide-react';
import { COMMAND_CATEGORIES, COMMAND_GROUPS, K8S_COMMANDS } from '../data/k8sCommands';

const DRAG_TYPE = 'application/k8s-command';

export default function CommandPalette() {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return K8S_COMMANDS;
    return K8S_COMMANDS.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(q) ||
        cmd.description.toLowerCase().includes(q) ||
        cmd.kubectl.toLowerCase().includes(q) ||
        cmd.group.toLowerCase().includes(q),
    );
  }, [query]);

  const toggleSection = (id: string) => {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <aside className="palette">
      <div className="palette__header">
        <h2>Command Library</h2>
        <p>Grouped by resource type. Drag onto canvas to build workflows.</p>
      </div>

      <div className="palette__search">
        <Search size={16} />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search commands..."
        />
      </div>

      <div className="palette__categories">
        {COMMAND_CATEGORIES.map((category) => {
          const groups = COMMAND_GROUPS.filter((group) => group.categoryId === category.id);
          const categoryCommands = filtered.filter((cmd) => cmd.category === category.id);
          if (categoryCommands.length === 0) return null;

          const categoryCollapsed = collapsed[`cat-${category.id}`];

          return (
            <section key={category.id} className="palette__category">
              <button
                type="button"
                className="palette__category-toggle palette__category-toggle--main"
                onClick={() => toggleSection(`cat-${category.id}`)}
              >
                {categoryCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                <span style={{ color: category.color }}>{category.label}</span>
                <span className="palette__count">{categoryCommands.length}</span>
              </button>

              {!categoryCollapsed &&
                groups.map((group) => {
                  const commands = categoryCommands.filter((cmd) => cmd.group === group.id);
                  if (commands.length === 0) return null;
                  const groupCollapsed = collapsed[`grp-${group.id}`];

                  return (
                    <div key={group.id} className="palette__group">
                      <button
                        type="button"
                        className="palette__category-toggle palette__category-toggle--sub"
                        onClick={() => toggleSection(`grp-${group.id}`)}
                      >
                        {groupCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                        <span style={{ color: group.color }}>{group.label}</span>
                        <span className="palette__count">{commands.length}</span>
                      </button>

                      {!groupCollapsed && (
                        <ul className="palette__list">
                          {commands.map((cmd) => (
                            <li key={cmd.id}>
                              <div
                                className="palette__item"
                                draggable
                                onDragStart={(e) => {
                                  e.dataTransfer.setData(DRAG_TYPE, cmd.id);
                                  e.dataTransfer.effectAllowed = 'move';
                                }}
                                style={{ borderLeftColor: cmd.color }}
                              >
                                <GripVertical size={14} className="palette__grip" />
                                <div>
                                  <div className="palette__item-title">{cmd.label}</div>
                                  <div className="palette__item-desc">{cmd.description}</div>
                                  <code className="palette__item-kubectl">{cmd.kubectl}</code>
                                </div>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
            </section>
          );
        })}
      </div>
    </aside>
  );
}

export { DRAG_TYPE };
