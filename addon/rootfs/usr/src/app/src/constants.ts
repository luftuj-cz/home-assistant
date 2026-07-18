export const APP_VERSION = "1.1.0-dev";

// Sentinel duration for an infinite boost override (minutes). Shared by the
// timeline scheduler and the MQTT command handler so they can't drift apart.
export const INFINITE_BOOST_DURATION_MINUTES = 999999;
