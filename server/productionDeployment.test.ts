import assert from "node:assert/strict";
import test from "node:test";
import { productionDeployment, productionEnvironment, productionUrl } from "../scripts/deploy-production";

test("production releases ignore development URLs and service tokens", () => {
  const env = productionEnvironment({
    CONVEX_DEPLOYMENT: "dev:fabulous-elephant-597",
    CONVEX_URL: "https://fabulous-elephant-597.convex.cloud",
    VITE_CONVEX_URL: "https://fabulous-elephant-597.convex.cloud",
    CONVEX_SERVICE_TOKEN: "development-token"
  });
  assert.equal(env.CONVEX_DEPLOYMENT, productionDeployment);
  assert.equal(env.CONVEX_URL, productionUrl);
  assert.equal(env.VITE_CONVEX_URL, productionUrl);
  assert.equal(env.CONVEX_SERVICE_TOKEN, undefined);
});

test("production releases reject keys and host overrides targeting another deployment", () => {
  for (const key of ["dev:fabulous-elephant-597|test", "prod:another-project|test", "preview:test|test"]) {
    assert.throws(() => productionEnvironment({ CONVEX_DEPLOY_KEY: key }), /must belong to production/);
  }
  for (const name of ["CONVEX_SELF_HOSTED_URL", "CONVEX_SELF_HOSTED_ADMIN_KEY", "CONVEX_DEPLOYMENT_TOKEN", "CONVEX_PROVISION_HOST"]) {
    assert.throws(() => productionEnvironment({ [name]: "override" }), /cannot override/);
  }
});

test("production releases preserve a key scoped to the production deployment", () => {
  const key = `${productionDeployment}|test`;
  assert.equal(productionEnvironment({ CONVEX_DEPLOY_KEY: key }).CONVEX_DEPLOY_KEY, key);
});
