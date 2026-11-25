import { IconCheck, IconSelector, IconX } from "@tabler/icons-react";
import { Command as CommandPrimitive } from "cmdk";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { useMediaQuery } from "@luftuj/shared/utils/useMediaQuery";
import { cn } from "@luftuj/shared/utils/cn";

import { Mark, normalizeSearch } from "./mark";

import { CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "./command";
import { Dot } from "./dot";
import { useFieldControl, type FieldControlProps } from "./field-context";
import { ICON_STROKE, type IconComponent } from "./icon-types";
import { fieldSurface } from "./input";
import { Popover, PopoverAnchor, PopoverContent } from "./popover";
import { Sheet, SheetContent, SheetHeader } from "./sheet";

/** Below this width the list opens in a bottom sheet, like a Dialog turns into one. */
const PHONE = "(max-width: 560px)";

export interface ComboOption {
  value: string;
  label: string;
  /** A second line under the label. */
  description?: string;
  /** An id shown as a mono second line (`number.luftator_obyvak`); searchable too. */
  code?: string;
  /** Options with the same group sit under one legend, in order of first appearance. */
  group?: string;
  /** A colour dot before the label (a mode's colour). */
  dot?: string;
  icon?: IconComponent;
  /** Right-aligned mono note ("30 %"). */
  meta?: ReactNode;
  /** The label itself is an id or a script name. */
  mono?: boolean;
  disabled?: boolean;
}

/* ---------- search: diacritics ignored, matches marked ---------- */

function filterOption(_value: string, search: string, keywords?: string[]) {
  const needle = normalizeSearch(search.trim());
  return !needle || normalizeSearch((keywords ?? []).join(" ")).includes(needle) ? 1 : 0;
}

function matches(option: ComboOption, query: string) {
  return (
    filterOption(option.value, query, [
      option.label,
      option.description ?? "",
      option.code ?? "",
      option.value,
    ]) > 0
  );
}

function groupOptions(options: ComboOption[]) {
  const groups = new Map<string, ComboOption[]>();
  for (const option of options) {
    const key = option.group ?? "";
    groups.set(key, [...(groups.get(key) ?? []), option]);
  }
  return [...groups.entries()];
}

function OptionContent({
  option,
  query,
  selected,
  multi,
}: Readonly<{ option: ComboOption; query: string; selected: boolean; multi?: boolean }>) {
  const Icon = option.icon;
  return (
    <>
      {multi && (
        <span
          aria-hidden="true"
          className={cn(
            "grid size-[18px] flex-none place-items-center rounded-[5px] text-air-foreground shadow-[inset_0_0_0_1.5px_var(--input)] transition-colors duration-(--duration-fast)",
            selected && "bg-air shadow-none",
          )}
        >
          {selected && <IconCheck size={12} stroke={2.5} className="text-air-foreground!" />}
        </span>
      )}
      {option.dot && <Dot color={option.dot} />}
      {Icon && <Icon size={16} stroke={ICON_STROKE} aria-hidden />}
      <span className="grid min-w-0 flex-1">
        <span
          className={cn(
            "truncate",
            option.mono && "font-mono text-xs",
            !multi && selected && "font-medium",
          )}
        >
          <Mark text={option.label} query={query} />
        </span>
        {option.description && (
          <span className="caption truncate text-muted-foreground">{option.description}</span>
        )}
        {option.code && (
          <span className="truncate font-mono text-[11px] leading-4 text-muted-foreground">
            <Mark text={option.code} query={query} />
          </span>
        )}
      </span>
      {option.meta && (
        <span className="flex-none font-mono text-[11px] text-muted-foreground">{option.meta}</span>
      )}
      {!multi && selected && (
        <IconCheck size={16} stroke={ICON_STROKE} className="flex-none text-air!" aria-hidden />
      )}
    </>
  );
}

function OptionList({
  options,
  query,
  isSelected,
  onPick,
  emptyText,
  label,
  multi,
  className,
}: Readonly<{
  options: ComboOption[];
  query: string;
  isSelected: (value: string) => boolean;
  onPick: (option: ComboOption) => void;
  emptyText?: ReactNode;
  label: string;
  multi?: boolean;
  className?: string;
}>) {
  const { t } = useTranslation();
  return (
    <CommandList aria-label={label} aria-multiselectable={multi || undefined} className={className}>
      <CommandEmpty>{emptyText ?? t("ui.nothingFound")}</CommandEmpty>
      {groupOptions(options).map(([group, items]) => (
        <CommandGroup key={group || "_"} heading={group || undefined}>
          {items.map((option) => (
            <CommandItem
              key={option.value}
              value={option.value}
              keywords={[option.label, option.description ?? "", option.code ?? "", option.value]}
              disabled={option.disabled}
              onSelect={() => onPick(option)}
            >
              <OptionContent
                option={option}
                query={query}
                selected={isSelected(option.value)}
                multi={multi}
              />
            </CommandItem>
          ))}
        </CommandGroup>
      ))}
    </CommandList>
  );
}

/** The control's accessible name as text (its Field label without the required mark), for the sheet's title. */
function accessibleName(field: FieldControlProps) {
  if (field["aria-label"]) return field["aria-label"];
  const names = (field["aria-labelledby"] ?? "").split(/\s+/).map((id) => {
    const label = id ? document.getElementById(id)?.cloneNode(true) : null;
    if (!(label instanceof HTMLElement)) return "";
    for (const hidden of label.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
    return label.textContent?.trim() ?? "";
  });
  return names.filter(Boolean).join(" ");
}

/** The id of the highlighted option, for `aria-activedescendant` on a trigger that keeps focus. */
function activeOptionId(list: HTMLElement | null, value: string) {
  return list?.querySelector<HTMLElement>(`[cmdk-item][data-value="${CSS.escape(value)}"]`)?.id;
}

/* ---------- Combobox ---------- */

interface ComboboxProps extends FieldControlProps {
  options: ComboOption[];
  value?: string | null;
  defaultValue?: string | null;
  onValueChange?: (value: string | null) => void;
  placeholder?: ReactNode;
  /** A search field on top of the list; on by default for more than 7 options. */
  searchable?: boolean;
  /** A × in the field that clears the value. */
  clearable?: boolean;
  icon?: IconComponent;
  emptyText?: ReactNode;
  defaultOpen?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
}

/**
 * A select whose list opens in a popover: search (diacritics ignored, matches marked), groups, a second line, a dot
 * or icon and an optional clear button. ↓ or Enter opens, ↑ ↓ move, Enter picks, Esc
 * closes; the highlight starts on the selected option. The list opens upwards when the room below is short. On
 * touch the search field does not take focus by itself, so the keyboard does not push the page. On a phone the list
 * opens in a bottom sheet titled with the field's label, with larger rows.
 */
export function Combobox({
  options,
  value,
  defaultValue = null,
  onValueChange,
  placeholder,
  searchable,
  clearable,
  icon: Icon,
  emptyText,
  defaultOpen = false,
  disabled,
  invalid,
  className,
  ...props
}: Readonly<ComboboxProps>) {
  const { t } = useTranslation();
  const field = useFieldControl({ ...props, invalid });
  const coarse = useMediaQuery("(pointer: coarse)");
  const phone = useMediaQuery(PHONE);
  const [sheetTitle, setSheetTitle] = useState("");
  const [inner, setInner] = useState<string | null>(defaultValue);
  const [open, setOpenState] = useState(defaultOpen);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState("");
  const [activeId, setActiveId] = useState<string | undefined>(undefined);
  // State, not a ref: the list mounts a render after `open` (portal), and the effects must see it.
  const [listEl, setListEl] = useState<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const current = value === undefined ? inner : value;
  const selected = options.find((o) => o.value === current);
  const canSearch = searchable ?? options.length > 7;

  // Without a search field focus stays on the trigger, so it points at the highlighted option.
  useEffect(() => {
    setActiveId(open ? activeOptionId(listEl, active) : undefined);
  }, [open, active, listEl]);

  function setOpen(next: boolean) {
    setOpenState(next);
    setQuery("");
    if (next) {
      setActive(current ?? options.find((o) => !o.disabled)?.value ?? "");
      if (phone) setSheetTitle(accessibleName(field));
    }
  }

  function pick(option: ComboOption) {
    setInner(option.value);
    onValueChange?.(option.value);
    setOpen(false);
  }

  function onTriggerKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(true);
    } else if (!open) {
      // Closed: keep cmdk from swallowing keys meant for the page (Tab, arrows).
      e.stopPropagation();
    }
  }

  const trigger = (
    <button
      type="button"
      role="combobox"
      aria-haspopup="listbox"
      aria-expanded={open}
      ref={triggerRef}
      aria-activedescendant={canSearch ? undefined : activeId}
      disabled={disabled}
      {...field}
      onClick={() => setOpen(!open)}
      onKeyDown={onTriggerKeyDown}
      className={cn(
        fieldSurface,
        "flex cursor-pointer items-center gap-2.5 text-left",
        open && "bg-card shadow-[inset_0_0_0_2px_var(--ring)]",
        Icon && "pl-3",
      )}
    >
      {Icon && (
        <Icon
          size={16}
          stroke={ICON_STROKE}
          className="flex-none text-muted-foreground"
          aria-hidden
        />
      )}
      {selected ? (
        <span
          className={cn("flex min-w-0 flex-1 items-center gap-2", clearable && !disabled && "mr-7")}
        >
          {selected.dot && <Dot color={selected.dot} />}
          <span className={cn("truncate", selected.mono && "font-mono text-sm")}>
            {selected.label}
          </span>
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {placeholder ?? t("ui.choose")}
        </span>
      )}
      <IconSelector
        size={16}
        stroke={ICON_STROKE}
        className="flex-none text-muted-foreground"
        aria-hidden
      />
    </button>
  );
  const clearButton = clearable && selected && !disabled && (
    <button
      type="button"
      aria-label={t("ui.clearSelection")}
      onClick={() => {
        setInner(null);
        onValueChange?.(null);
      }}
      className="absolute top-1/2 right-9 grid size-6 -translate-y-1/2 cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      <IconX size={14} stroke={ICON_STROKE} aria-hidden />
    </button>
  );
  const search = canSearch && (
    <CommandInput
      placeholder={t("ui.search")}
      aria-label={t("ui.searchLabel")}
      value={query}
      onValueChange={setQuery}
    />
  );
  function list(className?: string) {
    return (
      <div ref={setListEl} className="contents">
        <OptionList
          options={options}
          query={canSearch ? query : ""}
          isSelected={(v) => v === current}
          onPick={pick}
          emptyText={emptyText}
          label={t("ui.options")}
          className={className}
        />
      </div>
    );
  }

  return (
    <CommandPrimitive
      data-slot="combobox"
      filter={filterOption}
      shouldFilter={canSearch}
      value={active}
      onValueChange={setActive}
      className={cn("relative min-w-0", className)}
    >
      {phone ? (
        <Sheet open={open} onOpenChange={setOpen} autoFocus={canSearch && !coarse}>
          {trigger}
          {clearButton}
          <SheetContent
            aria-describedby={undefined}
            // Searchable lists keep their height while filtering, so the sheet does not jump under the finger.
            className={cn(canSearch && "h-[min(600px,85dvh)]")}
          >
            <SheetHeader title={sheetTitle || t("ui.options")} />
            <div
              className={cn(
                "grid min-h-0 [&_[cmdk-item]]:min-h-11",
                canSearch ? "grid-rows-[auto_minmax(0,1fr)]" : "grid-rows-[minmax(0,1fr)]",
              )}
            >
              {search}
              {list("max-h-none min-h-0")}
            </div>
          </SheetContent>
        </Sheet>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverAnchor asChild>{trigger}</PopoverAnchor>
          {clearButton}
          <PopoverContent
            className="w-(--radix-popover-trigger-width) min-w-[220px]"
            onOpenAutoFocus={(e) => {
              // Focus stays on the trigger without a search field, and on touch (no keyboard popping up).
              if (!canSearch || coarse) {
                e.preventDefault();
              }
            }}
            onInteractOutside={(e) => {
              // The trigger toggles on its own click; closing here first would reopen it.
              if (triggerRef.current?.contains(e.target as Node)) {
                e.preventDefault();
              }
            }}
          >
            {search}
            {list()}
          </PopoverContent>
        </Popover>
      )}
    </CommandPrimitive>
  );
}

/* ---------- MultiSelect ---------- */

interface MultiSelectProps extends FieldControlProps {
  options: ComboOption[];
  value?: string[];
  defaultValue?: string[];
  onValueChange?: (values: string[]) => void;
  placeholder?: string;
  emptyText?: ReactNode;
  /** At most this many values. */
  max?: number;
  defaultOpen?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  "aria-label"?: string;
  className?: string;
}

/**
 * Several values from one list: picked values are chips in the field, the list has checkboxes and a count. Typing
 * filters; Enter toggles the highlighted option and keeps the list open; Backspace in an empty field removes the
 * last chip.
 */
export function MultiSelect({
  options,
  value,
  defaultValue = [],
  onValueChange,
  placeholder,
  emptyText,
  max,
  defaultOpen = false,
  disabled,
  invalid,
  "aria-label": ariaLabel,
  className,
  ...props
}: Readonly<MultiSelectProps>) {
  const { t } = useTranslation();
  const field = useFieldControl({ ...props, invalid });
  const [inner, setInner] = useState<string[]>(defaultValue);
  const [open, setOpen] = useState(defaultOpen);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState("");
  const [activeId, setActiveId] = useState<string | undefined>(undefined);
  const [listId, setListId] = useState<string | undefined>(undefined);
  const fieldRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // State, not a ref: the list mounts a render after `open` (portal), and the effects must see it.
  const [listEl, setListEl] = useState<HTMLDivElement | null>(null);
  const current = value ?? inner;
  // Filtered here, not by cmdk: cmdk's own input would force aria-expanded="true" and point aria-controls at a
  // list that does not exist while closed. cmdk still drives ↑ ↓ and Enter.
  const visible = options.filter((option) => matches(option, query));

  useEffect(() => {
    setListId(
      open ? (listEl?.querySelector<HTMLElement>("[cmdk-list]")?.id ?? undefined) : undefined,
    );
    setActiveId(open ? activeOptionId(listEl, active) : undefined);
  }, [open, active, query, listEl]);

  function set(next: string[]) {
    setInner(next);
    onValueChange?.(next);
  }

  function toggle(option: ComboOption) {
    if (current.includes(option.value)) {
      set(current.filter((v) => v !== option.value));
    } else if (!max || current.length < max) {
      set([...current, option.value]);
    }
  }

  return (
    <CommandPrimitive
      data-slot="multi-select"
      shouldFilter={false}
      value={active}
      onValueChange={setActive}
      className={cn("relative min-w-0", className)}
    >
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setQuery("");
          }
        }}
      >
        <PopoverAnchor asChild>
          <div
            ref={fieldRef}
            data-slot="multi-select-field"
            data-disabled={disabled || undefined}
            onClick={(e) => {
              if (!disabled && !(e.target as HTMLElement).closest("[data-chip]")) {
                inputRef.current?.focus();
                setOpen(true);
              }
            }}
            className={cn(
              fieldSurface,
              "flex h-auto min-h-11 cursor-text flex-wrap items-center gap-1.5 px-2 py-1.5",
              open && "bg-card shadow-[inset_0_0_0_2px_var(--ring)]",
              field["aria-invalid"] && "shadow-[inset_0_0_0_2px_var(--destructive)]",
              "data-disabled:cursor-not-allowed data-disabled:opacity-55",
            )}
          >
            {current.map((v) => {
              const option = options.find((o) => o.value === v) ?? { value: v, label: v };
              return (
                <span
                  key={v}
                  data-chip=""
                  title={option.code}
                  className="inline-flex h-[30px] max-w-full animate-pop items-center gap-1.5 rounded-sm bg-card pr-1 pl-2.5 font-sans text-[13px] leading-4 font-medium shadow-plane"
                >
                  {option.dot && <Dot color={option.dot} />}
                  <span className={cn("truncate", option.mono && "font-mono text-xs")}>
                    {option.label}
                  </span>
                  <button
                    type="button"
                    aria-label={t("ui.remove", { name: option.label })}
                    disabled={disabled}
                    onClick={() => set(current.filter((x) => x !== v))}
                    className="grid size-[22px] cursor-pointer place-items-center rounded-[4px] text-muted-foreground hover:bg-destructive-soft hover:text-destructive"
                  >
                    <IconX size={12} stroke={ICON_STROKE} aria-hidden />
                  </button>
                </span>
              );
            })}
            <input
              ref={inputRef}
              {...field}
              role="combobox"
              aria-label={ariaLabel}
              aria-autocomplete="list"
              aria-expanded={open}
              aria-controls={listId}
              aria-activedescendant={activeId}
              value={query}
              disabled={disabled}
              placeholder={current.length ? "" : (placeholder ?? t("ui.choose"))}
              onChange={(e) => {
                const next = e.target.value;
                setQuery(next);
                setActive(
                  options.find((option) => !option.disabled && matches(option, next))?.value ?? "",
                );
                setOpen(true);
              }}
              onFocus={() => {
                setOpen(true);
                setActive(
                  (prev) => prev || (visible.find((option) => !option.disabled)?.value ?? ""),
                );
              }}
              onKeyDown={(e) => {
                if (e.key === "Backspace" && !query && current.length) {
                  set(current.slice(0, -1));
                }
              }}
              className="h-[30px] min-w-20 flex-[1_1_80px] bg-transparent font-sans text-sm leading-5 text-foreground outline-none placeholder:text-muted-foreground pointer-coarse:text-base"
            />
          </div>
        </PopoverAnchor>
        <PopoverContent
          className="w-(--radix-popover-trigger-width) min-w-[220px]"
          onOpenAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            // A click into the field (a chip, the input) is not "outside".
            if (fieldRef.current?.contains(e.target as Node)) {
              e.preventDefault();
            }
          }}
        >
          <div ref={setListEl} className="contents">
            <OptionList
              options={visible}
              query={query}
              isSelected={(v) => current.includes(v)}
              onPick={toggle}
              emptyText={emptyText}
              label={t("ui.options")}
              multi
            />
          </div>
          <div className="caption mt-1 flex items-center justify-between gap-2 border-t border-border px-2 pt-2 pb-0.5 text-muted-foreground">
            <span>{t("ui.selectedCount", { count: current.length })}</span>
            {current.length > 0 && (
              <button
                type="button"
                onClick={() => set([])}
                className="cursor-pointer text-air underline decoration-1 underline-offset-3 hover:decoration-2"
              >
                {t("ui.deselectAll")}
              </button>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </CommandPrimitive>
  );
}
