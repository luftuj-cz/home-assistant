/*
 * Dev-only showcase of the design-system primitives (route #/ui, never in a production build). Each section mirrors
 * the matching preview in the design system, so the two can be compared side by side in light and dark.
 * Demo copy is inline Czech on purpose: it is fixture data, not app text.
 */
import {
  IconCalendarEvent,
  IconCheck,
  IconCopy,
  IconEdit,
  IconPlayerPlay,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconAlertTriangle,
} from "@tabler/icons-react";
import { useState } from "react";

import { useTheme } from "@luftuj/shared/theme/useTheme";
import { OwnComponents } from "./OwnComponents";
import { Section } from "./ShowcaseSection";
import { Alert } from "@luftuj/shared/ui/alert";
import { Badge } from "@luftuj/shared/ui/badge";
import { Button } from "@luftuj/shared/ui/button";
import { Calendar } from "@luftuj/shared/ui/calendar";
import { Card, CardFooter, CardHeader } from "@luftuj/shared/ui/card";
import { Checkbox } from "@luftuj/shared/ui/checkbox";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
  DialogClose,
} from "@luftuj/shared/ui/dialog";
import { Input } from "@luftuj/shared/ui/input";
import { Field } from "@luftuj/shared/ui/field";
import { MetricTile } from "@luftuj/shared/ui/metric-tile";
import { StatusBadge } from "@luftuj/shared/ui/status-badge";
import { Menu } from "@luftuj/shared/ui/dropdown-menu";
import { notify } from "@luftuj/shared/ui/notify";
import { Progress } from "@luftuj/shared/ui/progress";
import { RadioGroup } from "@luftuj/shared/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@luftuj/shared/ui/select";
import { Separator } from "@luftuj/shared/ui/separator";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTrigger } from "@luftuj/shared/ui/sheet";
import { Skeleton } from "@luftuj/shared/ui/skeleton";
import { Slider } from "@luftuj/shared/ui/slider";
import { Spinner } from "@luftuj/shared/ui/spinner";
import { Switch } from "@luftuj/shared/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@luftuj/shared/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@luftuj/shared/ui/tabs";
import { Toast } from "@luftuj/shared/ui/sonner";
import { ToggleGroup } from "@luftuj/shared/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@luftuj/shared/ui/tooltip";

const TABLE_ROWS = [
  { name: "Teplota přívodu", reg: "IR 10211", val: "21.4 °C" },
  { name: "Teplota venkovní", reg: "IR 10212", val: "4.8 °C" },
  { name: "Výkon", reg: "HR 10704", val: "65 %" },
  { name: "Režim", reg: "HR 10705", val: "Větrání" },
];

export default function UiShowcasePage() {
  const { colorScheme, setColorScheme } = useTheme();
  const [toggle, setToggle] = useState("light");

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-2 bg-background font-sans text-sm leading-5 text-foreground">
      <div className="flex items-center justify-between gap-4 p-5">
        <h1 className="page-title">Primitivy</h1>
        <ToggleGroup
          aria-label="Motiv"
          value={colorScheme}
          onValueChange={(v) => setColorScheme(v === "dark" ? "dark" : "light")}
          items={[
            { value: "light", label: "Světlý" },
            { value: "dark", label: "Tmavý" },
          ]}
        />
      </div>

      <Section id="button" title="Button">
        <div className="flex flex-wrap items-center gap-2">
          <Button>Uložit</Button>
          <Button variant="secondary">Zrušit</Button>
          <Button variant="outline" icon={IconPlus}>
            Přidat režim
          </Button>
          <Button variant="ghost">Více</Button>
          <Button variant="air" icon={IconCheck}>
            Testovat připojení
          </Button>
          <Button variant="destructive" icon={IconTrash}>
            Smazat mód
          </Button>
          <Button variant="link">Upravit data období</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm">Malé</Button>
          <Button size="lg">Spustit nastavení</Button>
          <Button variant="manual" icon={IconPlayerPlay}>
            Spustit
          </Button>
          <Button variant="plan" icon={IconPlayerPlay}>
            Zapnout
          </Button>
          <Button size="icon" variant="secondary" aria-label="Obnovit" icon={IconRefresh} />
          <Button size="icon-sm" variant="ghost" aria-label="Upravit" icon={IconEdit} />
          <Button loading>Ukládám…</Button>
          <Button disabled>Nedostupné</Button>
        </div>
      </Section>

      <Section id="badge" title="Badge">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="default">Výchozí</Badge>
          <Badge>v1.1.3</Badge>
          <Badge variant="outline">Beta</Badge>
          <Badge variant="air" dot>
            Dnes
          </Badge>
          <Badge variant="success" icon={IconCheck}>
            OK
          </Badge>
          <Badge variant="warning" icon={IconAlertTriangle}>
            Nenastaveno
          </Badge>
          <Badge variant="destructive">Chyba</Badge>
          <Badge variant="manual">Manuální</Badge>
          <Badge variant="plan" dot>
            Vlastní plán
          </Badge>
        </div>
      </Section>

      <Section id="card" title="Card">
        <div className="max-w-[460px]">
          <Card>
            <CardHeader
              legend="Rekuperace · Modbus TCP"
              title="Atrea RD5"
              description="192.168.1.40:502 · ID 1"
              action={<StatusBadge status="success" label="Připojeno" />}
            />
            <div className="grid grid-cols-2 gap-3">
              <MetricTile legend="Min. výkon" value="20" unit="%" />
              <MetricTile legend="Max. výkon" value="80" unit="%" />
            </div>
            <CardFooter>
              <Button variant="ghost" size="sm">
                Testovat
              </Button>
              <Button size="sm">Uložit</Button>
            </CardFooter>
          </Card>
        </div>
      </Section>

      <Section id="alert" title="Alert">
        <div className="grid gap-3">
          <Alert variant="info" action={<Button variant="link">Upravit data období</Button>}>
            Prohlížíš období Zima. Aktivní je Podzim – změny se projeví, až Zima začne.
          </Alert>
          <Alert variant="warning" title="Pozor">
            Pokud jsou všechny klapky zavřené a rekuperace je zapnutá, hrozí poškození servopohonů
            LUFTaTORu či samotné rekuperační jednotky!
          </Alert>
          <Alert
            variant="destructive"
            title="Modbus spojení ztraceno"
            action={
              <Button variant="secondary" size="sm" icon={IconRefresh}>
                Zkusit znovu
              </Button>
            }
          >
            Modbus zařízení odmítlo spojení — zkontrolujte, že je zapnuté a dostupné
          </Alert>
          <Alert variant="plan" title="Vlastní plán Dovolená">
            Tento plán teď nahrazuje týdenní časovou osu.
          </Alert>
        </div>
      </Section>

      <Section id="input" title="Input">
        <div className="grid max-w-[340px] gap-4">
          <Field label="IP adresa hostitele" htmlFor="sc-ip">
            <Input id="sc-ip" placeholder="192.168.1.10" className="font-mono" />
          </Field>
          <Field label="Heslo" htmlFor="sc-pw">
            <Input id="sc-pw" type="password" defaultValue="heslo1234" />
          </Field>
          <Field label="ID jednotky" htmlFor="sc-id" description="Nelze měnit, dokud běží test.">
            <Input id="sc-id" defaultValue="1" disabled />
          </Field>
        </div>
      </Section>

      <Section id="select" title="Select">
        <div className="max-w-[360px]">
          <Field label="Model" htmlFor="sc-model">
            <Select defaultValue="rd5">
              <SelectTrigger id="sc-model">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="rd5">Atrea RD5</SelectItem>
                <SelectItem value="am">Atrea aMotion</SelectItem>
                <SelectItem value="xvent">Xvent</SelectItem>
                <SelectItem value="zehnder">Zehnder ComfoAir Q</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      </Section>

      <Section id="switch" title="Switch">
        <div className="grid max-w-[440px] gap-5">
          <Switch
            defaultChecked
            label="Povolit MQTT"
            description="Entity se objeví v Home Assistantu automaticky."
          />
          <Switch
            label="Zobrazit jako tlačítko manuální akce"
            description="Režim se objeví v Manuálním režimu na Přehledu."
          />
          <Switch disabled label="Režim ladění" />
          <div className="flex items-center gap-3">
            <Switch size="sm" defaultChecked aria-label="Povolit událost 06:00 Den" />
            <Switch size="sm" aria-label="Povolit událost 22:30 Noc" />
          </div>
        </div>
      </Section>

      <Section id="checkbox" title="Checkbox">
        <div className="grid gap-3">
          <Checkbox defaultChecked label="Obývací pokoj" />
          <Checkbox label="Ložnice" />
          <Checkbox disabled label="Dětský pokoj (offline)" />
        </div>
      </Section>

      <Section id="radiogroup" title="RadioGroup">
        <div className="max-w-[420px]">
          <RadioGroup
            defaultValue="week"
            aria-label="Vyplnit"
            items={[
              { value: "week", label: "Celý týden", description: "Vyplnit všech 7 dní." },
              { value: "work", label: "Pracovní dny" },
              { value: "weekend", label: "Víkend" },
            ]}
          />
        </div>
      </Section>

      <Section id="slider" title="Slider">
        <div className="grid max-w-[440px] gap-7">
          <Slider
            defaultValue={60}
            labels={["0 %", "50 %", "100 %"]}
            aria-label="Výkon"
            format={(v) => `${v} %`}
          />
          <Slider
            defaultValue={45}
            max={90}
            step={5}
            fill="none"
            tone="valve-partial"
            ticks={6}
            labels={["Otev.", "45°", "Zavř."]}
            aria-label="Klapka Ložnice"
            format={(v) => `${v}°`}
          />
        </div>
      </Section>

      <Section id="tabs" title="Tabs">
        <Tabs defaultValue="values">
          <TabsList>
            <TabsTrigger value="values">Hodnoty backendu</TabsTrigger>
            <TabsTrigger value="ha">Home Assistant API</TabsTrigger>
            <TabsTrigger value="logs">Logy serveru</TabsTrigger>
          </TabsList>
          <TabsContent value="values">
            <p className="body text-muted-foreground">Živé hodnoty registrů.</p>
          </TabsContent>
          <TabsContent value="ha">
            <p className="body text-muted-foreground">Volání API.</p>
          </TabsContent>
          <TabsContent value="logs">
            <p className="body text-muted-foreground">Poslední záznamy.</p>
          </TabsContent>
        </Tabs>
      </Section>

      <Section id="tooltip" title="Tooltip">
        <div className="pt-11 pl-[120px]">
          <Tooltip defaultOpen>
            <TooltipTrigger asChild>
              <span className="card-title" tabIndex={0}>
                Obývací pokoj
              </span>
            </TooltipTrigger>
            <TooltipContent>number.luftator_obyvak</TooltipContent>
          </Tooltip>
        </div>
      </Section>

      <Section id="progress" title="Progress">
        <div className="grid gap-4">
          <Progress value={65} label="65 %" aria-label="Výkon" />
          <Progress value={40} tone="manual" label="24:12" aria-label="Zbývající čas" />
        </div>
      </Section>

      <Section id="skeleton" title="Skeleton">
        <div className="grid max-w-[380px] gap-5 rounded-xl bg-card p-6 shadow-plane">
          <div className="flex items-center gap-3">
            <Skeleton className="size-12 rounded-full" />
            <div className="grid gap-1.5">
              <Skeleton className="h-4 w-[180px]" />
              <Skeleton className="h-3 w-[120px]" />
            </div>
          </div>
          <Skeleton className="h-2 rounded-full" />
        </div>
      </Section>

      <Section id="spinner" title="Spinner">
        <div className="flex flex-wrap items-center gap-6">
          <Spinner />
          <Spinner label="Nastavuji režim na jednotce — může to trvat pár vteřin…" />
        </div>
      </Section>

      <Section id="table" title="Table">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Proměnná</TableHead>
              <TableHead>Registr</TableHead>
              <TableHead className="text-right">Hodnota</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {TABLE_ROWS.map((row) => (
              <TableRow key={row.reg}>
                <TableCell>{row.name}</TableCell>
                <TableCell className="font-mono">{row.reg}</TableCell>
                <TableCell className="text-right font-mono">{row.val}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      <Section id="togglegroup" title="ToggleGroup">
        <div className="grid justify-items-start gap-3">
          <ToggleGroup
            aria-label="Motiv ukázky"
            value={toggle}
            onValueChange={setToggle}
            items={[
              { value: "light", label: "Světlý" },
              { value: "dark", label: "Tmavý" },
            ]}
          />
          <ToggleGroup
            size="sm"
            aria-label="Jazyk"
            defaultValue="cs"
            items={[
              { value: "cs", label: "Čeština" },
              { value: "en", label: "English" },
            ]}
          />
          <ToggleGroup
            full
            aria-label="Doba trvání"
            defaultValue="u"
            items={[
              { value: "u", label: "Do odvolání" },
              { value: "t", label: "Do data" },
            ]}
          />
        </div>
      </Section>

      <Section id="menu" title="Menu">
        <Menu
          align="start"
          label="Akce události 06:00"
          items={[
            { label: "Upravit", icon: IconEdit },
            { label: "Duplikovat", icon: IconCopy },
            { label: "Smazat", icon: IconTrash, destructive: true },
          ]}
        />
      </Section>

      <Section id="calendar" title="Calendar">
        <div className="w-[312px] rounded-lg bg-popover p-4 shadow-float">
          <Calendar
            mode="single"
            defaultMonth={new Date(2026, 10, 1)}
            selected={new Date(2026, 10, 24)}
            today={new Date(2026, 10, 21)}
            disabled={{ before: new Date(2026, 10, 21) }}
          />
        </div>
      </Section>

      <Section id="dialog" title="Dialog">
        <div className="flex flex-wrap gap-2">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="secondary">Otevřít dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader
                legend="Časová osa"
                title="Vytvořit režim"
                description="Režim určuje výkon jednotky a polohu klapek."
              />
              <DialogBody>
                <Field label="Název režimu" htmlFor="sc-mode">
                  <Input id="sc-mode" placeholder="např. Komfort" defaultValue="Noc" />
                </Field>
                <Switch label="Zobrazit jako tlačítko manuální akce" />
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="ghost">Zrušit</Button>
                </DialogClose>
                <Button>Vytvořit</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="secondary">Potvrzení</Button>
            </DialogTrigger>
            <DialogContent size="sm" tone="danger">
              <DialogHeader
                legend="Nevratné"
                title="Smazat mód Noc?"
                description="Smažou se i jeho 4 události."
              />
              <DialogFooter start={<Button variant="danger-ghost">Smazat i události</Button>}>
                <DialogClose asChild>
                  <Button variant="ghost">Zrušit</Button>
                </DialogClose>
                <Button variant="destructive">Smazat mód</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </Section>

      <Section id="sheet" title="Sheet">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="secondary">Otevřít sheet</Button>
          </SheetTrigger>
          <SheetContent>
            <SheetHeader title="Vlastní plán" />
            <SheetBody>
              <Field label="Plán" htmlFor="sc-plan">
                <Select defaultValue="d">
                  <SelectTrigger id="sc-plan" icon={IconCalendarEvent}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="d">Dovolená</SelectItem>
                    <SelectItem value="c">Chalupa</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <ToggleGroup
                full
                aria-label="Doba trvání"
                defaultValue="u"
                items={[
                  { value: "u", label: "Do odvolání" },
                  { value: "t", label: "Do data" },
                ]}
              />
              <Button variant="plan" size="lg">
                Zapnout
              </Button>
            </SheetBody>
          </SheetContent>
        </Sheet>
      </Section>

      <Section id="toast" title="Toast">
        <div className="grid grid-cols-[minmax(0,1fr)] justify-items-start gap-3">
          <Toast variant="success" title="Režim vytvořen" description="Noc · 30 %" />
          <Toast variant="manual" title="Manuální režim aktivní" description="Zbývá 30 min" />
          <Toast
            variant="destructive"
            title="Modbus spojení ztraceno"
            description="Další pokus za 10 s."
            action={
              <Button variant="secondary" size="sm">
                Teď
              </Button>
            }
          />
          <Separator />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() =>
                notify({
                  variant: "success",
                  title: "Uloženo",
                  message: "Nastavení jednotky bylo uloženo.",
                })
              }
            >
              notify success
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                notify({
                  variant: "error",
                  title: "Nepodařilo se uložit",
                  message: "Spojení s jednotkou vypršelo.",
                })
              }
            >
              notify error
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                notify({
                  variant: "plan",
                  title: "Vlastní plán Dovolená",
                  message: "Běží do neděle 18:00.",
                })
              }
            >
              notify plan
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                notify({
                  title: "Kopíruji den Pondělí",
                  message: "Klepněte na den, kam ho vložit.",
                  loading: true,
                  autoClose: false,
                  dismissible: false,
                  id: "sc-loading",
                })
              }
            >
              notify loading
            </Button>
          </div>
        </div>
      </Section>
      <OwnComponents />
    </div>
  );
}
