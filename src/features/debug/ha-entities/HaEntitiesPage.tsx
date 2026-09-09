import { Fragment, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Code,
  Container,
  Group,
  Loader,
  ScrollArea,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconArrowLeft,
  IconChevronDown,
  IconChevronRight,
  IconRefresh,
  IconSearch,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useRouter } from "@tanstack/react-router";
import { resolveApiUrl } from "@luftuj/shared/utils/api";

interface HaEntity {
  entityId: string;
  domain: string;
  state: string;
  friendlyName: string;
  unit: string | null;
  deviceClass: string | null;
  attributes: Record<string, unknown>;
  lastChanged: string | null;
}

interface HaEntitiesResponse {
  available: boolean;
  connection?: string;
  detail?: string;
  entityCount?: number;
  entities: HaEntity[];
}

const ALL_DOMAINS = "__all__";

export function HaEntitiesPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [domain, setDomain] = useState<string>(ALL_DOMAINS);
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isLoading, isFetching, refetch, isError } = useQuery({
    queryKey: ["ha-entities"],
    queryFn: async () => {
      const res = await fetch(resolveApiUrl("/api/debug/home-assistant/entities"), {
        cache: "no-cache",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as HaEntitiesResponse;
    },
    staleTime: 15 * 1000,
  });

  const entities = data?.entities ?? [];

  const domainOptions = useMemo(() => {
    const domains = Array.from(new Set(entities.map((e) => e.domain))).sort((a, b) =>
      a.localeCompare(b),
    );
    return [
      {
        value: ALL_DOMAINS,
        label: t("debug.haEntities.allDomains", { defaultValue: "All domains" }),
      },
      ...domains.map((d) => ({ value: d, label: d })),
    ];
  }, [entities, t]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return entities.filter((e) => {
      if (domain !== ALL_DOMAINS && e.domain !== domain) return false;
      if (!term) return true;
      return e.entityId.toLowerCase().includes(term) || e.friendlyName.toLowerCase().includes(term);
    });
  }, [entities, search, domain]);

  return (
    <Container size="xl">
      <Stack gap="xl">
        <Stack gap="xs">
          <Group justify="space-between" align="flex-start">
            <div>
              <Title order={1}>
                {t("debug.haEntities.title", { defaultValue: "Home Assistant Entities" })}
              </Title>
              <Text c="dimmed">
                {t("debug.haEntities.description", {
                  defaultValue:
                    "Browse all Home Assistant entities and their current values (sensors, scripts, and more).",
                })}
              </Text>
            </div>
            <Button
              variant="light"
              leftSection={<IconArrowLeft size={16} />}
              onClick={() => router.navigate({ to: "/debug" })}
            >
              {t("debug.haEntities.back", { defaultValue: "Back to Debug" })}
            </Button>
          </Group>
        </Stack>

        {isError && (
          <Alert icon={<IconAlertCircle size={16} />} color="red">
            {t("debug.haEntities.loadFailed", { defaultValue: "Failed to load entities." })}
          </Alert>
        )}

        {data && !data.available && (
          <Alert icon={<IconAlertCircle size={16} />} color="yellow">
            {data.detail ??
              t("debug.haEntities.unavailable", {
                defaultValue: "Home Assistant is not available.",
              })}
          </Alert>
        )}

        <Group>
          <TextInput
            flex={1}
            placeholder={t("debug.haEntities.searchPlaceholder", {
              defaultValue: "Search by entity id or name…",
            })}
            leftSection={<IconSearch size={16} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
          />
          <Select
            data={domainOptions}
            value={domain}
            onChange={(v) => setDomain(v ?? ALL_DOMAINS)}
            searchable
            w={220}
          />
          <Button
            variant="light"
            leftSection={<IconRefresh size={16} />}
            loading={isFetching}
            onClick={() => void refetch()}
          >
            {t("debug.haEntities.refresh", { defaultValue: "Refresh" })}
          </Button>
        </Group>

        {isLoading ? (
          <Group justify="center" py="xl">
            <Loader />
          </Group>
        ) : (
          <>
            <Text size="sm" c="dimmed">
              {t("debug.haEntities.count", {
                defaultValue: "{{shown}} of {{total}} entities",
                shown: filtered.length,
                total: entities.length,
              })}
            </Text>
            <ScrollArea>
              <Table striped highlightOnHover withTableBorder miw={720}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>
                      {t("debug.haEntities.colEntity", { defaultValue: "Entity" })}
                    </Table.Th>
                    <Table.Th>{t("debug.haEntities.colName", { defaultValue: "Name" })}</Table.Th>
                    <Table.Th>{t("debug.haEntities.colState", { defaultValue: "State" })}</Table.Th>
                    <Table.Th>{t("debug.haEntities.colUnit", { defaultValue: "Unit" })}</Table.Th>
                    <Table.Th>
                      {t("debug.haEntities.colDeviceClass", { defaultValue: "Device class" })}
                    </Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {filtered.map((e) => {
                    const isOpen = expanded === e.entityId;
                    const hasAttributes = Object.keys(e.attributes).length > 0;
                    const chevron = isOpen ? (
                      <IconChevronDown size={14} />
                    ) : (
                      <IconChevronRight size={14} />
                    );
                    return (
                      <Fragment key={e.entityId}>
                        <Table.Tr>
                          <Table.Td>
                            <UnstyledButton
                              onClick={() => setExpanded(isOpen ? null : e.entityId)}
                              disabled={!hasAttributes}
                            >
                              <Group gap="xs" wrap="nowrap">
                                {hasAttributes ? chevron : <span style={{ width: 14 }} />}
                                <Badge size="xs" variant="light">
                                  {e.domain}
                                </Badge>
                                <Text size="sm" ff="monospace">
                                  {e.entityId}
                                </Text>
                              </Group>
                            </UnstyledButton>
                          </Table.Td>
                          <Table.Td>{e.friendlyName}</Table.Td>
                          <Table.Td>
                            <Text size="sm" ff="monospace">
                              {e.state}
                            </Text>
                          </Table.Td>
                          <Table.Td>{e.unit ?? ""}</Table.Td>
                          <Table.Td>{e.deviceClass ?? ""}</Table.Td>
                        </Table.Tr>
                        {isOpen && (
                          <Table.Tr>
                            <Table.Td colSpan={5}>
                              <Code block>{JSON.stringify(e.attributes, null, 2)}</Code>
                            </Table.Td>
                          </Table.Tr>
                        )}
                      </Fragment>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          </>
        )}
      </Stack>
    </Container>
  );
}
