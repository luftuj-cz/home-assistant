import {
  Anchor,
  AppShell,
  Box,
  Button,
  Drawer,
  Group,
  Image,
  Stack,
  Text,
  Title,
  Burger,
  UnstyledButton,
  rem,
  Paper,
  Container,
  Grid,
  Divider,
  Badge,
  ThemeIcon,
  NavLink,
  Loader,
  Center,
  useComputedColorScheme,
} from "@mantine/core";
import { motion } from "framer-motion";
import { APP_VERSION } from "../config";
import {
  IconAt,
  IconPhone,
  IconLayoutDashboard,
  IconDeviceFloppy,
  IconTimeline,
  IconSettings,
  IconBug,
} from "@tabler/icons-react";
import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useDisclosure } from "@mantine/hooks";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useEffect } from "react";
import logoFullLight from "../assets/logo-full-light.svg";
import logoFullDark from "../assets/logo-full-dark.svg";
import logoMarkLight from "../assets/logo-mark-light.svg";
import logoMarkDark from "../assets/logo-mark-dark.svg";

export function AppLayout() {
  const [mobileNavOpened, { toggle, close }] = useDisclosure(false);
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const footerLink = import.meta.env.VITE_FOOTER_LINK ?? "https://www.luftuj.cz/";
  const computedColorScheme = useComputedColorScheme("light", { getInitialValueInEffect: true });

  const logoFull = computedColorScheme === "dark" ? logoFullDark : logoFullLight;
  const logoMark = computedColorScheme === "dark" ? logoMarkDark : logoMarkLight;

  // Check Onboarding Status
  const { data: onboardingStatus, isLoading: isLoadingStatus } = useQuery({
    queryKey: ["onboarding-layout-check"],
    queryFn: async () => {
      const res = await fetch("/api/settings/onboarding-status");
      if (!res.ok) return null; // Fail silently
      return (await res.json()) as { onboardingDone: boolean };
    },
    // Don't refetch too often, just initial load is critical
    refetchOnWindowFocus: false,
  });

  const { data: debugMode } = useQuery({
    queryKey: ["debug-mode-check"],
    queryFn: async () => {
      const res = await fetch("/api/settings/debug-mode");
      if (!res.ok) return { enabled: false };
      return (await res.json()) as { enabled: boolean };
    },
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (isLoadingStatus) return;
    if (!onboardingStatus) return;

    const isDoingOnboarding = location.pathname === "/onboarding";

    if (onboardingStatus.onboardingDone === false && !isDoingOnboarding) {
      navigate({ to: "/onboarding" });
    } else if (onboardingStatus.onboardingDone === true && isDoingOnboarding) {
      navigate({ to: "/" });
    }
  }, [onboardingStatus, isLoadingStatus, location.pathname, navigate]);

  const isOnboarding = location.pathname === "/onboarding";
  const showNav = onboardingStatus?.onboardingDone !== false;

  const navItems = useMemo(() => {
    if (!showNav) return [];
    const items = [
      { to: "/", label: t("app.nav.dashboard"), icon: IconLayoutDashboard },
      { to: "/valves", label: t("app.nav.valves"), icon: IconDeviceFloppy },
      { to: "/timeline", label: t("app.nav.timeline"), icon: IconTimeline },
      { to: "/settings", label: t("app.nav.settings"), icon: IconSettings },
    ];

    if (debugMode?.enabled) {
      items.push({ to: "/debug", label: t("app.nav.debug"), icon: IconBug });
    }

    return items;
  }, [t, showNav, debugMode?.enabled]);

  function isActive(to: string) {
    return location.pathname === to;
  }

  return (
    <AppShell
      header={{ height: 70 }}
      withBorder={true}
      styles={{
        header: {
          backgroundColor: "var(--mantine-color-body)",
          borderBottom: "1px solid var(--mantine-color-default-border)",
        },
        main: {
          backgroundColor: "var(--mantine-color-body)",
          color: "var(--mantine-color-text)",
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
        },
      }}
    >
      <AppShell.Header>
        <Container size="xl" h="100%">
          <Group h="100%" px={0} justify="space-between">
            <UnstyledButton
              component={Link}
              to="/"
              p={0}
              h="100%"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                textDecoration: "none",
              }}
            >
              <div>
                <Group gap="sm" align="center" wrap="nowrap">
                  <Image src={logoMark} alt={t("app.title")} h={32} w={32} fit="contain" />
                  <Title
                    order={2}
                    fw={800}
                    ff="inherit"
                    size={rem(22)}
                    c="var(--mantine-color-text)"
                    style={{ letterSpacing: -0.5 }}
                  >
                    {t("app.title")}
                  </Title>
                </Group>
              </div>
            </UnstyledButton>

            {showNav && (
              <Group gap="sm" visibleFrom="md">
                <Paper
                  px="xs"
                  py={4}
                  radius="lg"
                  style={{
                    backgroundColor: "var(--mantine-color-default-hover)",
                    border: "1px solid var(--mantine-color-default-border)",
                    position: "relative",
                    zIndex: 1,
                  }}
                >
                  <Group gap={4} wrap="nowrap">
                    {navItems.map((item) => {
                      const active = isActive(item.to);
                      const IconComponent = item.icon;
                      return (
                        <Button
                          key={item.to}
                          component={Link}
                          to={item.to}
                          variant="subtle"
                          size="sm"
                          radius="md"
                          leftSection={
                            <motion.div
                              animate={{
                                scale: active ? 1.1 : 1,
                                color: active
                                  ? "var(--mantine-color-primary-filled)"
                                  : "var(--mantine-color-dimmed)",
                              }}
                              transition={{ duration: 0.2 }}
                            >
                              <IconComponent size={18} stroke={active ? 2.5 : 2} />
                            </motion.div>
                          }
                          styles={{
                            root: {
                              fontWeight: active ? 700 : 500,
                              transition: "color 0.2s ease",
                              border: "none",
                              backgroundColor: "transparent",
                              position: "relative",
                              zIndex: 2,
                              color: active
                                ? "var(--mantine-color-text)"
                                : "var(--mantine-color-dimmed)",
                              "&:hover": {
                                backgroundColor: "transparent",
                                color: "var(--mantine-color-text)",
                              },
                            },
                          }}
                        >
                          <Box style={{ position: "relative", zIndex: 2 }}>{item.label}</Box>
                          {active && (
                            <motion.div
                              layoutId="nav-active-pill"
                              style={{
                                position: "absolute",
                                inset: 0,
                                backgroundColor: "rgba(255, 255, 255, 0.08)",
                                borderRadius: "var(--mantine-radius-md)",
                                zIndex: 1,
                                border: "1px solid rgba(255, 255, 255, 0.1)",
                                boxShadow: "0 4px 12px rgba(0, 0, 0, 0.2)",
                              }}
                              transition={{
                                type: "spring",
                                stiffness: 380,
                                damping: 30,
                              }}
                            />
                          )}
                        </Button>
                      );
                    })}
                  </Group>
                </Paper>
              </Group>
            )}

            {showNav && (
              <Box hiddenFrom="md" style={{ display: "flex", alignItems: "center" }}>
                <Burger
                  opened={mobileNavOpened}
                  onClick={toggle}
                  aria-label="Toggle navigation"
                  size="md"
                />
              </Box>
            )}
          </Group>
        </Container>
      </AppShell.Header>

      <Drawer
        opened={mobileNavOpened}
        onClose={close}
        padding="xl"
        title={
          <Group gap="xs" align="center">
            <Image src={logoMark} alt={t("app.title")} h={28} w={28} fit="contain" />
            <Title order={4} fw={600} ff="inherit" size={rem(18)} c="var(--mantine-color-text)">
              {t("app.nav.navigate")}
            </Title>
          </Group>
        }
        size="100%"
        hiddenFrom="md"
        styles={{
          content: {
            backgroundColor: "var(--mantine-color-body)",
          },
          header: {
            borderBottom: "1px solid var(--mantine-color-default-border)",
            paddingBottom: "1rem",
          },
          body: {
            paddingTop: "1.5rem",
          },
        }}
        overlayProps={{
          opacity: 0.5,
          blur: 2,
        }}
      >
        <Stack gap="xs">
          {navItems.map((item, index) => {
            const active = isActive(item.to);
            const IconComponent = item.icon;
            return (
              <motion.div
                key={item.to}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05, duration: 0.3 }}
              >
                <NavLink
                  component={Link}
                  to={item.to}
                  onClick={close}
                  label={
                    <Text size="md" fw={active ? 700 : 500}>
                      {item.label}
                    </Text>
                  }
                  leftSection={
                    <motion.div
                      animate={{
                        scale: active ? 1.15 : 1,
                        color: active ? "var(--mantine-color-primary-filled)" : "inherit",
                      }}
                    >
                      <IconComponent size={24} stroke={1.5} />
                    </motion.div>
                  }
                  active={active}
                  variant="light"
                  color={active ? "primary" : "gray"}
                  style={{
                    borderRadius: "var(--mantine-radius-md)",
                    transition: "all 0.2s ease",
                  }}
                />
              </motion.div>
            );
          })}
        </Stack>
      </Drawer>

      <AppShell.Main>
        <Box p={{ base: "sm", sm: "md" }} style={{ flex: 1 }}>
          {isLoadingStatus && !isOnboarding ? (
            <Center style={{ height: "60vh" }}>
              <Loader size="xl" />
            </Center>
          ) : !showNav && !isOnboarding ? (
            <Center style={{ height: "60vh" }}>
              <Stack align="center">
                <Loader size="lg" />
                <Text c="dimmed">{t("onboarding.status.waitingTitle")}</Text>
              </Stack>
            </Center>
          ) : (
            <Outlet />
          )}
        </Box>

        <Box
          component="footer"
          pt="xl"
          pb="md"
          style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}
        >
          <Container size="xl">
            <Stack gap="xl">
              <Grid gutter="xl" align="flex-start">
                <Grid.Col span={{ base: 12, md: 4 }} order={{ base: 2, md: 1 }}>
                  <Stack gap="sm" align="center">
                    <Text fw={700} size="xs" tt="uppercase" lts={1.2} c="dimmed" ta="center" mb={4}>
                      {t("app.footer.contact")}
                    </Text>
                    <Stack gap={10} align="center">
                      <Group gap={12} wrap="nowrap" justify="center">
                        <ThemeIcon variant="light" radius="md" size="md">
                          <IconPhone size={16} stroke={2} />
                        </ThemeIcon>
                        <Anchor
                          href={t("app.footer.phoneLink")}
                          size="sm"
                          c="var(--mantine-color-text)"
                          fw={500}
                          underline="hover"
                        >
                          {t("app.footer.phone")}
                        </Anchor>
                      </Group>
                      <Group gap={12} wrap="nowrap" justify="center">
                        <ThemeIcon variant="light" radius="md" size="md">
                          <IconAt size={16} stroke={2} />
                        </ThemeIcon>
                        <Anchor
                          href={t("app.footer.emailLink")}
                          size="sm"
                          c="var(--mantine-color-text)"
                          fw={500}
                          underline="hover"
                        >
                          {t("app.footer.email")}
                        </Anchor>
                      </Group>
                    </Stack>
                  </Stack>
                </Grid.Col>

                <Grid.Col span={{ base: 12, md: 4 }} order={{ base: 1, md: 2 }}>
                  <Stack gap="xs" align="center" w="100%">
                    <Anchor
                      href={footerLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      underline="never"
                      style={{ display: "inline-flex", alignItems: "center", gap: rem(12) }}
                    >
                      <Image src={logoFull} alt={t("app.footer.company")} h={42} fit="contain" />
                    </Anchor>
                  </Stack>
                </Grid.Col>

                <Grid.Col span={{ base: 12, md: 4 }} order={{ base: 3, md: 3 }}>
                  <Stack gap="sm" align="center">
                    <Text fw={700} size="xs" tt="uppercase" lts={1.2} c="dimmed" ta="center" mb={4}>
                      {t("app.footer.location")}
                    </Text>
                    <Stack gap={4} align="center">
                      <Text size="sm" fw={600} ta="center">
                        {t("app.footer.addressLine1")}
                      </Text>
                      <Text size="sm" c="dimmed" ta="center">
                        {t("app.footer.addressLine2")}
                      </Text>
                    </Stack>
                  </Stack>
                </Grid.Col>
              </Grid>

              <Divider variant="dashed" />

              <Group justify="space-between" align="center" pb="lg" wrap="wrap" gap="sm">
                <Box visibleFrom="md">
                  <Text size="xs" c="dimmed">
                    © {new Date().getFullYear()} {t("app.footer.company")}.{" "}
                    {t("app.footer.allRightsReserved")}
                  </Text>
                </Box>
                <Box hiddenFrom="md" w="100%" style={{ textAlign: "center" }}>
                  <Text size="xs" c="dimmed">
                    © {new Date().getFullYear()} {t("app.footer.company")}.
                  </Text>
                  <Text size="xs" c="dimmed">
                    {t("app.footer.allRightsReserved")}
                  </Text>
                </Box>

                <Box visibleFrom="md">
                  <Badge variant="light" color="gray" size="sm" radius="sm">
                    v{APP_VERSION}
                  </Badge>
                </Box>
                <Box hiddenFrom="md" w="100%" style={{ display: "flex", justifyContent: "center" }}>
                  <Badge variant="light" color="gray" size="sm" radius="sm">
                    v{APP_VERSION}
                  </Badge>
                </Box>
              </Group>
            </Stack>
          </Container>
        </Box>
      </AppShell.Main>
    </AppShell>
  );
}
