// Firebase loads this deployment entry. The existing application exports remain
// in index.ts; the optional administrative marketing module is composed here so
// it cannot make Microsoft credentials a dependency of unrelated Functions.
export * from "./index";
export * from "./adminMarketingEmail";
