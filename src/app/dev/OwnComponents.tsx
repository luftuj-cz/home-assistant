/* Dev-only showcase of LUFTaTOR's own components (phase 1b), mirroring the design-system previews. */
import { IconAdjustmentsHorizontal, IconRefresh, IconScript, IconWind } from "@tabler/icons-react";
import { useState } from "react";

import { AnimatedNumber } from "@luftuj/shared/ui/animated-number";
import { Button } from "@luftuj/shared/ui/button";
import { CodeBlock } from "@luftuj/shared/ui/code-block";
import { Collapse } from "@luftuj/shared/ui/collapse";
import { ColorField } from "@luftuj/shared/ui/color-field";
import { Combobox, MultiSelect, type ComboOption } from "@luftuj/shared/ui/combobox";
import { CopyButton } from "@luftuj/shared/ui/copy-button";
import { DateTimeField } from "@luftuj/shared/ui/date-time-field";
import { EmptyState } from "@luftuj/shared/ui/empty-state";
import { ErrorState } from "@luftuj/shared/ui/error-state";
import { Field } from "@luftuj/shared/ui/field";
import { Fieldset } from "@luftuj/shared/ui/fieldset";
import { FileButton } from "@luftuj/shared/ui/file-button";
import { IconDamper, IconModbus, IconMqtt } from "@luftuj/shared/ui/icons";
import { Input } from "@luftuj/shared/ui/input";
import { Legend } from "@luftuj/shared/ui/legend";
import { MetricTile } from "@luftuj/shared/ui/metric-tile";
import { NumberInput } from "@luftuj/shared/ui/number-input";
import { SearchInput } from "@luftuj/shared/ui/search-input";
import { Separator } from "@luftuj/shared/ui/separator";
import { StatStrip } from "@luftuj/shared/ui/stat-strip";
import { StatusBadge } from "@luftuj/shared/ui/status-badge";
import { Switch } from "@luftuj/shared/ui/switch";
import { TextLink } from "@luftuj/shared/ui/text-link";
import { TimeField } from "@luftuj/shared/ui/time-field";
import { Well } from "@luftuj/shared/ui/well";

import { Section } from "./ShowcaseSection";

const UNITS: ComboOption[] = [
  { value: "atrea-rd5", label: "Atrea RD5", description: "Modbus TCP · 502", group: "Atrea" },
  { value: "atrea-am", label: "Atrea aMotion", description: "Modbus TCP · 502", group: "Atrea" },
  { value: "xvent", label: "Xvent HRV 300", description: "Modbus TCP · 502", group: "Xvent" },
  { value: "xvent-400", label: "Xvent HRV 400", description: "Modbus TCP · 502", group: "Xvent" },
  {
    value: "zehnder-q",
    label: "Zehnder ComfoAir Q",
    description: "přes ComfoConnect PRO",
    group: "Zehnder",
  },
  {
    value: "zehnder-e",
    label: "Zehnder ComfoAir E",
    description: "přes ComfoConnect PRO",
    group: "Zehnder",
  },
  {
    value: "komfovent",
    label: "Komfovent Domekt",
    description: "Modbus TCP · 502",
    group: "Ostatní",
  },
  { value: "paul", label: "Paul Novus 300", description: "Modbus TCP · 502", group: "Ostatní" },
];

const MODES: ComboOption[] = [
  { value: "1", label: "Noc", dot: "var(--mode-6)", meta: "30 %" },
  { value: "2", label: "Den", dot: "var(--mode-1)", meta: "55 %" },
  { value: "3", label: "Komfort", dot: "var(--mode-2)", meta: "70 %" },
  { value: "4", label: "Nárazové větrání", dot: "var(--mode-4)", meta: "90 %" },
  { value: "5", label: "Nepřítomnost", dot: "var(--mode-8)", meta: "20 %" },
];

const VALVES: ComboOption[] = [
  ["obyvak", "Obývák"],
  ["kuchyn", "Kuchyň"],
  ["loznice", "Ložnice"],
  ["detsky_pokoj", "Dětský pokoj"],
  ["pracovna", "Pracovna"],
  ["koupelna", "Koupelna"],
  ["wc", "WC"],
  ["satna", "Šatna"],
].map(([key, label]) => ({
  value: `number.luftator_${key}`,
  label,
  code: `number.luftator_${key}`,
}));

const SWATCHES = [
  ["#0b6f80", "Petrolejová"],
  ["#2f7d4f", "Zelená"],
  ["#6a5bc4", "Fialová"],
  ["#b4470f", "Oranžová"],
  ["#8b3a7e", "Švestková"],
  ["#3567a6", "Modrá"],
  ["#8a6400", "Okrová"],
  ["#56656a", "Břidlicová"],
].map(([value, label]) => ({ value, label }));

const PRESETS = [
  { label: "Dnes 22:00", value: "2026-11-21T22:00" },
  { label: "Zítra 18:00", value: "2026-11-22T18:00" },
  { label: "Za 3 dny", value: "2026-11-24T18:00" },
  { label: "Za týden", value: "2026-11-28T18:00" },
];

const VITALS = [
  { legend: "Verze", value: "1.2.0", hint: "Node v22.11.0 · arm64" },
  { legend: "Běží", value: "3 d 4 h", hint: "od 18. 11. 10:02" },
  { legend: "Paměť", value: "84.2", unit: "MiB", hint: "RSS" },
  { legend: "Home Assistant", value: "Připojeno", tone: "success" as const },
  { legend: "MQTT", value: "Připojeno", tone: "success" as const, hint: "discovery 17:42" },
  { legend: "Klapky", value: "8", hint: "1 nedostupná", tone: "warning" as const },
];

const ATTRIBUTES = `{
  "friendly_name": "LUFTaTOR Obývák",
  "unit_of_measurement": "%",
  "min": 0,
  "max": 100
}`;

export function OwnComponents() {
  const [open, setOpen] = useState(true);
  const [temperature, setTemperature] = useState("21.4");

  return (
    <>
      <Section id="field" title="Field">
        <div className="grid max-w-[720px] grid-cols-[2fr_1fr_1fr] gap-4 max-sm:grid-cols-1">
          <Field label="IP adresa hostitele" required description="Adresa jednotky v lokální síti.">
            <Input defaultValue="192.168.1.40" className="font-mono" />
          </Field>
          <Field label="Port">
            <Input defaultValue="502" className="font-mono" />
          </Field>
          <Field label="ID jednotky">
            <Input defaultValue="1" className="font-mono" />
          </Field>
          <Field label="Broker hostitel" error="MQTT broker odmítl přihlašovací údaje">
            <Input defaultValue="core-mosquitto" />
          </Field>
          <Field label="Interval čtení">
            <Input defaultValue="10" unit="s" />
          </Field>
        </div>
      </Section>

      <Section id="numberinput" title="NumberInput">
        <div className="grid max-w-[600px] grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-4">
          <Field label="Výkon">
            <NumberInput defaultValue={55} min={0} max={90} step={5} unit="%" />
          </Field>
          <Field label="Teplota">
            <NumberInput defaultValue={21} min={10} max={30} step={0.5} unit="°C" />
          </Field>
          <Field label="Priorita">
            <NumberInput defaultValue={0} disabled />
          </Field>
        </div>
      </Section>

      <Section id="combobox" title="Combobox">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] items-start gap-6">
          <Field label="Model jednotky" description="Vyhledávání, skupiny, popisy">
            <Combobox options={UNITS} defaultValue="atrea-rd5" searchable />
          </Field>
          <Field label="Režim">
            <Combobox options={MODES} defaultValue="2" icon={IconWind} />
          </Field>
          <Field label="Skript (volitelné)">
            <Combobox
              options={[
                { value: "script.vetrani_koupelna", label: "script.vetrani_koupelna", mono: true },
                { value: "script.krb_start", label: "script.krb_start", mono: true },
              ]}
              defaultValue="script.krb_start"
              clearable
              searchable
              icon={IconScript}
            />
          </Field>
        </div>
      </Section>

      <Section id="multiselect" title="MultiSelect">
        <div className="max-w-[420px]">
          <Field label="Klapky ve skupině">
            <MultiSelect
              options={VALVES}
              defaultValue={["number.luftator_obyvak", "number.luftator_kuchyn"]}
              placeholder="Přidat klapku…"
            />
          </Field>
        </div>
      </Section>

      <Section id="timefield" title="TimeField">
        <div className="flex flex-wrap gap-6">
          <Field label="Čas začátku">
            <TimeField defaultValue="06:00" step={15} />
          </Field>
          <Field label="Neplatný čas" error="Událost v tento čas už existuje.">
            <TimeField defaultValue="17:30" />
          </Field>
        </div>
      </Section>

      <Section id="datetimefield" title="DateTimeField">
        <div className="max-w-[340px]">
          <Field label="Konec">
            <DateTimeField
              defaultValue="2026-11-24T18:00"
              min="2026-11-21T14:20"
              presets={PRESETS}
              hint="za 3 d"
              today="2026-11-21"
            />
          </Field>
        </div>
      </Section>

      <Section id="colorfield" title="ColorField">
        <div className="max-w-[420px]">
          <Field
            label="Barva režimu"
            description="Barvy palety fungují ve světlém i tmavém motivu. Vlastní barvu zadejte jako hex."
          >
            <ColorField swatches={SWATCHES} defaultValue="#2f7d4f" />
          </Field>
        </div>
      </Section>

      <Section id="fieldset" title="Fieldset">
        <div className="max-w-[520px]">
          <Fieldset
            legend="Proměnné jednotky"
            icon={IconAdjustmentsHorizontal}
            description="Co režim nastaví na rekuperační jednotce."
          >
            <div className="grid grid-cols-2 gap-3">
              <Field label="Výkon">
                <NumberInput defaultValue={55} unit="%" step={5} />
              </Field>
              <Field label="Teplota">
                <NumberInput defaultValue={21} unit="°C" />
              </Field>
            </div>
            <Switch
              label="Bypass"
              description="Rekuperace se obchází, venkovní vzduch jde přímo dovnitř."
            />
          </Fieldset>
        </div>
      </Section>

      <Section id="codeblock" title="CodeBlock">
        <div className="grid max-w-[520px] gap-4">
          <CodeBlock label="Atributy">{ATTRIBUTES}</CodeBlock>
          <div className="flex items-center gap-2">
            <span className="code">number.luftator_obyvak</span>
            <CopyButton value="number.luftator_obyvak" />
            <CopyButton value="x" withText />
          </div>
        </div>
      </Section>

      <Section id="searchinput" title="SearchInput">
        <div className="max-w-[360px]">
          <SearchInput placeholder="Hledat ve zprávách a kontextu…" defaultValue="modbus" />
        </div>
      </Section>

      <Section id="statstrip" title="StatStrip">
        <StatStrip items={VITALS} />
      </Section>

      <Section id="statusbadge" title="StatusBadge">
        <div className="grid gap-4">
          <div className="flex flex-wrap gap-6">
            <StatusBadge status="success" label="Připojeno" />
            <StatusBadge status="warning" label="Připojování…" />
            <StatusBadge status="error" label="Nedostupný" />
            <StatusBadge status="info" label="Obnovuji" />
            <StatusBadge status="neutral" label="Načítání" />
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge status="success" label="Připojeno" variant="pill" />
            <StatusBadge status="error" label="Odpojeno" variant="pill" />
          </div>
        </div>
      </Section>

      <Section id="metrictile" title="MetricTile">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
          <MetricTile legend="Venkovní" value="4.8" unit="°C" />
          <MetricTile legend="Přívod" value={temperature} unit="°C" />
          <MetricTile legend="CO₂" value="612" unit="ppm" />
          <MetricTile legend="Odtah" value="—" unit="°C" stale hint="Bez dat 2 min" />
        </div>
        <div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setTemperature((t) => (Number.parseFloat(t) + 1.7).toFixed(1))}
          >
            Přívod +1.7 (AnimatedNumber)
          </Button>
        </div>
      </Section>

      <Section id="emptystate" title="EmptyState">
        <EmptyState
          title="Nebyly nalezeny žádné klapky"
          description="LUFTaTOR hledá entity s prefixem number.luftator v Home Assistantu."
          action={
            <Button variant="secondary" icon={IconRefresh}>
              Obnovit klapky
            </Button>
          }
        />
      </Section>

      <Section id="errorstate" title="ErrorState">
        <ErrorState
          title="Nepodařilo se načíst klapky"
          description="Home Assistant je offline."
          details="GET /api/valves → 502"
        />
      </Section>

      <Section id="textlink" title="TextLink">
        <div className="grid gap-4">
          <p className="body">
            Návod najdete v{" "}
            <TextLink href="https://www.luftuj.cz" external>
              dokumentaci LUFTaTORu
            </TextLink>{" "}
            nebo napište na <TextLink href="mailto:info@luftuj.cz">info@luftuj.cz</TextLink>.
          </p>
          <Separator label="nebo" />
          <Separator />
        </div>
      </Section>

      <Section id="filebutton" title="FileButton">
        <FileButton accept=".db,.sqlite">Importovat databázi</FileButton>
      </Section>

      <Section id="icon" title="Icon">
        <div className="flex flex-wrap gap-8">
          {(
            [
              [IconModbus, "Modbus"],
              [IconDamper, "Klapky"],
              [IconMqtt, "MQTT"],
            ] as const
          ).map(([Glyph, label]) => (
            <div key={label} className="grid justify-items-center gap-2.5">
              <Well className="size-28 place-items-center p-0">
                <Glyph size={64} />
              </Well>
              <Legend>{label}</Legend>
            </div>
          ))}
          <div className="grid gap-2.5">
            <Legend>Velikosti</Legend>
            {[IconModbus, IconDamper, IconMqtt].map((Glyph, row) => (
              <div key={row} className="flex items-center gap-4">
                {[16, 18, 20, 24, 32].map((size) => (
                  <Glyph key={size} size={size} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Section id="collapse" title="Collapse · AnimatedNumber">
        <div className="grid max-w-[420px] gap-3">
          <Button variant="secondary" size="sm" onClick={() => setOpen((o) => !o)}>
            {open ? "Zavřít" : "Otevřít"}
          </Button>
          <Collapse open={open}>
            <Well legend="Obsah">
              <p className="body">Výška se animuje bez měření; zavřený obsah je inert.</p>
              <span className="readout">
                <AnimatedNumber value={temperature} />{" "}
                <span className="code text-muted-foreground">°C</span>
              </span>
            </Well>
          </Collapse>
          <p className="caption text-muted-foreground">Text pod Collapse se posouvá plynule.</p>
        </div>
      </Section>
    </>
  );
}
