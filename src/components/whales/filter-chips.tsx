import { actionFilterToLabel, type WhaleTableActionFilter } from "@/components/whales/interaction-state";

type FilterChipsProps = {
  filters: WhaleTableActionFilter[];
  activeFilter: WhaleTableActionFilter;
  onSelectFilter: (filter: WhaleTableActionFilter) => void;
};

export function FilterChips({ filters, activeFilter, onSelectFilter }: FilterChipsProps) {
  return (
    <div className="filter-chip-row" role="tablist" aria-label="Position action filters">
      {filters.map((filter) => (
        <button
          aria-label={filter}
          aria-selected={filter === activeFilter}
          className={filter === activeFilter ? "filter-chip is-active" : "filter-chip"}
          data-type={filter}
          key={filter}
          onClick={() => onSelectFilter(filter)}
          role="tab"
          type="button"
        >
          {actionFilterToLabel(filter)}
        </button>
      ))}
    </div>
  );
}
