import type { SlashAccountOwnership } from "../shared/slashApi";

// Verified against each entity's account filters in the Slash dashboard on
// 2026-11-09. Slash's charge-card balance endpoint currently returns balances
// across entities; these immutable provider IDs enforce the selected ownership.
export const slashAccountOwnership: SlashAccountOwnership = {
  mojo: {
    groupIds: ["sa_group_f783yx5hy987", "sa_group_njnvzhvnklyg"],
    accountIds: ["sa_13o02gbyz1ug8", "sa_1jg1h9hbgq606", "sa_1scl9uhma6tm2", "sa_26isl6h741x88", "sa_2gy67t3uxp7u9", "sa_2vz7vlu77gq0t"]
  },
  coveragebird: {
    groupIds: ["sa_group_29kyd5shhc26y"],
    accountIds: ["sa_1s6whkya4zxw8", "sa_282vj6nqo8k5w", "sa_2nh635taqaszm", "sa_lm8lswzlhoyn"]
  },
  coveragepro: {
    groupIds: ["sa_group_d9vcnwd5mvlf"],
    accountIds: ["sa_24fsxr5yvehqk", "sa_2r4nqap3a7hfp", "sa_hv0ky1lqd9y3", "sa_jwvgaoqyo2jh"]
  }
};
