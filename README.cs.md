# LUFTaTOR Home Assistant Frontend (česky)

[![English](https://img.shields.io/badge/lang-en-blue)](README.md) [![Čeština](https://img.shields.io/badge/lang-cs-red)](README.cs.md)

React + TypeScript UI dodávané **LUFTaTOR** pro správu ventilačních klapek **Luftatoru**. Jeden Home Assistant může dohlížet na více řídicích jednotek Luftatoru přes tento add-on. Aplikace je postavená na Vite a Mantine a pro frontend i backend add-onu používá **npm + Node.js**.

## Požadavky

- [Node.js 20+](https://nodejs.org/) (instalace závislostí a spouštění skriptů)
- npm (součást Node.js)

## Rychlý start

```bash
npm install          # instalace závislostí, vytvoří package-lock.json
npm run dev          # spustí Vite dev server na http://localhost:5173
# v addon/rootfs/usr/src/app/ (backend)
npm run dev          # spustí backend dev server
```

Vytvořte lokální `.env` v `addon/rootfs/usr/src/app/` (backend):

```
HA_BASE_URL=http://homeassistant.local:8123
HA_TOKEN=<HA_TOKEN>
PORT=8000
```
HA_TOKEN dokumentace: https://developers.home-assistant.io/docs/auth_api/#long-lived-access-token

## Skripty

- `npm run dev` – spustí Vite dev server s HMR.
- `npm run build` – typová kontrola (`tsc -b`) a build produkčních assetů.
- `npm run lint` – spustí ESLint nad projektem.
- `npm run preview` – lokální náhled produkčního buildu.
- `npm run build:addon` – produkční build a synchronizace do `addon/rootfs/usr/share/luftujha/www/` pro Home Assistant add-on.

## Verze add-onu

Pro jednotné zvýšení verze frontendu i add-onu použijte `scripts/set-version.mjs` z kořene repozitáře:

```bash
# stabilní (doplní -stable, pokud chybí)
node scripts/set-version.mjs --stable 1.2.3

# vývojová (doplní -dev, pokud chybí)
node scripts/set-version.mjs --dev 1.2.3
```

Skript upraví `package.json`, `src/config.ts`, `addon/config.yaml` a `addon/rootfs/usr/src/app/src/constants.ts`.

## Synchronizace assetů do add-onu

`npm run build:addon` spouští `scripts/sync-dist.mjs` v Node.js a zrcadlí `dist/` do rootfs add-onu. Skript skončí chybou, pokud předtím nespustíte `npm run build`, proto tento příkaz oba kroky kombinuje.

## Poznámky k Home Assistant

- Backend add-onu (`addon/rootfs/usr/src/app/`) běží na Node.js.
- Pro lokální testování spusťte backend `npm run dev` v tomto adresáři a frontend naměřte na API přes `VITE_API_BASE_URL`.
- Pro balení do Home Assistant: `npm run build:addon`, zkopírujte složku `addon/` do sdílené složky `/addons` a rebuildujte add-on v Supervisor UI.

## Lint a formátování

ESLint konfigurace je v `eslint.config.js`. Před synchronizací do add-onu spusťte `npm run lint`.
