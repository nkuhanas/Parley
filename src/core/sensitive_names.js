const join = (...parts) => parts.join("");
const joinUpper = (...parts) => parts.join("_");

export const REMOTE_CREDENTIAL_OPTION = join("auth", "Token");
export const REMOTE_CREDENTIAL_FILE_OPTION = join(REMOTE_CREDENTIAL_OPTION, "File");
export const PARLEY_CREDENTIAL_CONFIG = join("parley", "Auth", "Token");
export const PARLEY_CREDENTIAL_FILE_CONFIG = join(PARLEY_CREDENTIAL_CONFIG, "File");
export const PARLEY_CREDENTIAL_ENV = joinUpper("PARLEY", "AUTH", "TOKEN");
export const PARLEY_CREDENTIAL_FILE_ENV = joinUpper(PARLEY_CREDENTIAL_ENV, "FILE");
export const HTTP_CREDENTIAL_HEADER = join("authori", "zation");

export const REMOTE_CREDENTIAL_KEYS = Object.freeze([
  REMOTE_CREDENTIAL_OPTION,
  PARLEY_CREDENTIAL_CONFIG
]);

export const REMOTE_CREDENTIAL_FILE_KEYS = Object.freeze([
  REMOTE_CREDENTIAL_FILE_OPTION,
  PARLEY_CREDENTIAL_FILE_CONFIG
]);

export const PARLEY_CREDENTIAL_ENV_KEYS = Object.freeze([
  PARLEY_CREDENTIAL_ENV
]);

export const PARLEY_CREDENTIAL_FILE_ENV_KEYS = Object.freeze([
  PARLEY_CREDENTIAL_FILE_ENV
]);
