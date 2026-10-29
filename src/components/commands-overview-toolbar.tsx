import type { ComponentType } from "react";
import { ALargeSmall, ArrowDownWideNarrow, ArrowUpNarrowWide, CalendarClock, CalendarPlus, ChartColumnBig, Folder, LayoutGrid, Search } from "lucide-react";
import { Tooltip } from "./motion/tooltip";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

export type CommandSortField = "runCount" | "updatedAt" | "createdAt" | "name";
export type CommandSortDirection = "desc" | "asc";
type Option = { value: string; label: string; icon: ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean }> };

const SORT_FIELDS: Option[] = [
  { value: "runCount", label: "Run count", icon: ChartColumnBig },
  { value: "updatedAt", label: "Updated time", icon: CalendarClock },
  { value: "createdAt", label: "Created time", icon: CalendarPlus },
  { value: "name", label: "Name", icon: ALargeSmall },
];
const SORT_DIRECTIONS: Option[] = [
  { value: "desc", label: "Descending", icon: ArrowDownWideNarrow },
  { value: "asc", label: "Ascending", icon: ArrowUpNarrowWide },
];

function ToolbarSelect({ value, onChange, label, options }: {
  value: string; onChange: (value: string) => void; label: string; options: Option[];
}) {
  const selected = options.find((option) => option.value === value) ?? options[0];
  const Icon = selected.icon;
  const description = `${label}: ${selected.label}`;
  return (
    <Select value={value} onValueChange={onChange}>
      <Tooltip content={description} side="bottom" wrapperClassName="commands-filter-wrapper">
        <SelectTrigger className="commands-filter-trigger" aria-label={description}>
          <SelectValue>
            <span className="flex min-w-0 items-center gap-2">
              <Icon size={14} className="shrink-0" aria-hidden />
              <span className="commands-filter-label truncate">{selected.label}</span>
            </span>
          </SelectValue>
        </SelectTrigger>
      </Tooltip>
      <SelectContent className="max-w-[calc(100vw-16px)]">
        {options.map(({ value: optionValue, label: optionLabel, icon: OptionIcon }) => (
          <SelectItem key={optionValue} value={optionValue} textValue={optionLabel}>
            <span className="flex items-center gap-2">
              <OptionIcon size={14} className="shrink-0" aria-hidden />
              <span className="break-words">{optionLabel}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function CommandsOverviewToolbar({ searchQuery, onSearchChange, sortField, onSortFieldChange, sortDirection, onSortDirectionChange, sectionFilter, onSectionFilterChange, sections }: {
  searchQuery: string; onSearchChange: (value: string) => void;
  sortField: CommandSortField; onSortFieldChange: (value: CommandSortField) => void;
  sortDirection: CommandSortDirection; onSortDirectionChange: (value: CommandSortDirection) => void;
  sectionFilter: string; onSectionFilterChange: (value: string) => void; sections: string[];
}) {
  return (
    <div className="commands-overview-toolbar">
      <div className="commands-search relative min-w-0">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input value={searchQuery} onChange={(event) => onSearchChange(event.target.value)} placeholder="Search by name, section, or script" className="min-w-0 pl-9" aria-label="Search project commands" />
      </div>
      <ToolbarSelect value={sortField} onChange={(value) => onSortFieldChange(value as CommandSortField)} label="Sort commands by" options={SORT_FIELDS} />
      <ToolbarSelect value={sortDirection} onChange={(value) => onSortDirectionChange(value as CommandSortDirection)} label="Sort direction" options={SORT_DIRECTIONS} />
      <ToolbarSelect value={sectionFilter} onChange={onSectionFilterChange} label="Filter commands by section" options={sections.map((section) => ({ value: section, label: section === "all" ? "All sections" : section, icon: section === "all" ? LayoutGrid : Folder }))} />
    </div>
  );
}
