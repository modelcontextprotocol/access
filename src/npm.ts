import * as pulumi from '@pulumi/pulumi';
import { ROLES, type Role, buildRoleLookup } from './config/roles';
import { MEMBERS } from './config/users';
import { NPM_PACKAGE_ACCESS, type NpmPermission } from './config/npmPackages';
import type { RoleId } from './config/roleIds';

const config = new pulumi.Config('npm');
// npm integration is optional - only enabled if a token is configured.
// The token must be a granular access token created by an npm ORG OWNER with
// Organizations read/write permission (org admins get 403 on team package
// grants, and classic tokens require an OTP on every write).
const NPM_TOKEN = config.getSecret('token');
const NPM_ORG = config.get('org') ?? 'modelcontextprotocol';
const NPM_ENABLED = NPM_TOKEN !== undefined;

if (!NPM_ENABLED) {
  pulumi.log.info('npm integration disabled: token not configured');
}

const NPM_REGISTRY_BASE = 'https://registry.npmjs.org';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tryParseJson<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

class NpmApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
  }
}

async function npmFetch<T>(
  token: string,
  endpoint: string,
  options: RequestInit = {},
  maxRetries = 5
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(`${NPM_REGISTRY_BASE}${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (response.status === 429 || (response.status >= 500 && response.status < 600)) {
      const retryAfterSec = Number(response.headers.get('retry-after')) || 0;
      const backoffMs = Math.max(retryAfterSec * 1000, 2 ** attempt * 500) + Math.random() * 1000;
      lastError = new Error(`npm registry ${response.status} on ${endpoint}`);
      if (attempt < maxRetries) {
        await sleep(backoffMs);
        continue;
      }
      throw lastError;
    }

    if (!response.ok) {
      const text = await response.text();
      const body = tryParseJson<{ error?: string }>(text);
      throw new NpmApiError(
        `npm registry ${response.status} on ${endpoint}: ${body?.error ?? text.slice(0, 200)}`,
        response.status
      );
    }

    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  throw (
    lastError ?? new Error(`npm registry request to ${endpoint} failed after ${maxRetries} retries`)
  );
}

// ===================
// NpmTeam
// ===================
interface NpmTeamInputs {
  org: string;
  team: string;
  description: string;
  token: string;
}

const npmTeamProvider: pulumi.dynamic.ResourceProvider = {
  async create(inputs: NpmTeamInputs): Promise<pulumi.dynamic.CreateResult<NpmTeamInputs>> {
    try {
      await npmFetch<void>(inputs.token, `/-/org/${inputs.org}/team`, {
        method: 'PUT',
        body: JSON.stringify({ name: inputs.team, description: inputs.description }),
      });
    } catch (error) {
      // Adopt teams that already exist (e.g., created manually before this
      // config was introduced) instead of failing the deployment.
      if (!(error instanceof NpmApiError && error.status === 409)) {
        throw error;
      }
      pulumi.log.info(`npm team ${inputs.org}:${inputs.team} already exists, adopting`);
    }

    return { id: `${inputs.org}:${inputs.team}`, outs: inputs };
  },

  async read(id: string, props: NpmTeamInputs): Promise<pulumi.dynamic.ReadResult<NpmTeamInputs>> {
    const teams = await npmFetch<string[]>(props.token, `/-/org/${props.org}/team?format=cli`);
    if (!teams.includes(`${props.org}:${props.team}`)) {
      throw new Error(`npm team ${id} not found`);
    }
    return { id, props };
  },

  async diff(_id: string, olds: NpmTeamInputs, news: NpmTeamInputs) {
    // Teams cannot be renamed via the registry API - replace on rename.
    // description and token changes are state-only updates (no update()
    // defined, so Pulumi just persists the new inputs): the registry has no
    // team-metadata update endpoint, and recording a rotated token keeps
    // future read()/delete() calls working.
    const replaces: string[] = [];
    if (olds.org !== news.org) replaces.push('org');
    if (olds.team !== news.team) replaces.push('team');
    return {
      changes:
        replaces.length > 0 || olds.description !== news.description || olds.token !== news.token,
      replaces,
      deleteBeforeReplace: true,
    };
  },

  async delete(id: string, props: NpmTeamInputs): Promise<void> {
    try {
      await npmFetch<void>(props.token, `/-/team/${props.org}/${props.team}`, {
        method: 'DELETE',
      });
    } catch (error) {
      console.warn(`Failed to delete npm team ${id}: ${error}`);
    }
  },
};

class NpmTeam extends pulumi.dynamic.Resource {
  constructor(
    name: string,
    args: {
      org: pulumi.Input<string>;
      team: pulumi.Input<string>;
      description: pulumi.Input<string>;
      token: pulumi.Input<string>;
    },
    opts?: pulumi.CustomResourceOptions
  ) {
    super(npmTeamProvider, name, args, opts);
  }
}

// ===================
// NpmTeamUser
// ===================
interface NpmTeamUserInputs {
  org: string;
  team: string;
  user: string;
  token: string;
}

async function addUserToTeam(inputs: NpmTeamUserInputs): Promise<void> {
  // Team membership requires org membership. Add missing users with the
  // lowest role; never touch the role of existing members (an unconditional
  // PUT would demote owners/admins to 'developer').
  const orgMembers = await npmFetch<Record<string, string>>(
    inputs.token,
    `/-/org/${inputs.org}/user`
  );
  if (!(inputs.user in orgMembers)) {
    await npmFetch<void>(inputs.token, `/-/org/${inputs.org}/user`, {
      method: 'PUT',
      body: JSON.stringify({ user: inputs.user, role: 'developer' }),
    });
  }

  await npmFetch<void>(inputs.token, `/-/team/${inputs.org}/${inputs.team}/user`, {
    method: 'PUT',
    body: JSON.stringify({ user: inputs.user }),
  });
}

const npmTeamUserProvider: pulumi.dynamic.ResourceProvider = {
  async create(inputs: NpmTeamUserInputs): Promise<pulumi.dynamic.CreateResult<NpmTeamUserInputs>> {
    await addUserToTeam(inputs);
    return { id: `${inputs.org}:${inputs.team}:${inputs.user}`, outs: inputs };
  },

  async read(
    id: string,
    props: NpmTeamUserInputs
  ): Promise<pulumi.dynamic.ReadResult<NpmTeamUserInputs>> {
    const users = await npmFetch<string[]>(
      props.token,
      `/-/team/${props.org}/${props.team}/user?format=cli`
    );
    if (!users.includes(props.user)) {
      // Self-heal team membership: re-add the user now. Refresh only observes
      // drift, and with unchanged inputs Pulumi would never call update() to
      // fix it. But only for users still in the org - someone removed from
      // the org entirely (e.g. emergency offboarding done directly on npm)
      // must not be silently re-provisioned by a refresh.
      const orgMembers = await npmFetch<Record<string, string>>(
        props.token,
        `/-/org/${props.org}/user`
      );
      if (props.user in orgMembers) {
        await npmFetch<void>(props.token, `/-/team/${props.org}/${props.team}/user`, {
          method: 'PUT',
          body: JSON.stringify({ user: props.user }),
        });
      } else {
        console.warn(
          `npm user ${props.user} was removed from org ${props.org} outside of this config - ` +
            `not re-adding; remove them from users.ts to resolve`
        );
      }
    }
    return { id, props };
  },

  async diff(_id: string, olds: NpmTeamUserInputs, news: NpmTeamUserInputs) {
    // org/team/user identify the membership - changing any of them must go
    // through delete-then-create so the old membership is actually revoked
    // (an update would only add the new one). Token changes are state-only.
    const replaces: string[] = [];
    if (olds.org !== news.org) replaces.push('org');
    if (olds.team !== news.team) replaces.push('team');
    if (olds.user !== news.user) replaces.push('user');
    return {
      changes: replaces.length > 0 || olds.token !== news.token,
      replaces,
      deleteBeforeReplace: true,
    };
  },

  async delete(id: string, props: NpmTeamUserInputs): Promise<void> {
    // Remove from the team only - org membership removal stays manual so a
    // config change can never lock an owner out of the org.
    try {
      await npmFetch<void>(props.token, `/-/team/${props.org}/${props.team}/user`, {
        method: 'DELETE',
        body: JSON.stringify({ user: props.user }),
      });
    } catch (error) {
      console.warn(`Failed to remove npm user ${id} from team: ${error}`);
    }
  },
};

class NpmTeamUser extends pulumi.dynamic.Resource {
  constructor(
    name: string,
    args: {
      org: pulumi.Input<string>;
      team: pulumi.Input<string>;
      user: pulumi.Input<string>;
      token: pulumi.Input<string>;
    },
    opts?: pulumi.CustomResourceOptions
  ) {
    super(npmTeamUserProvider, name, args, opts);
  }
}

// ===================
// NpmTeamPackage
// ===================
interface NpmTeamPackageInputs {
  org: string;
  team: string;
  pkg: string;
  permissions: NpmPermission;
  token: string;
}

async function grantPackage(inputs: NpmTeamPackageInputs): Promise<void> {
  await npmFetch<void>(inputs.token, `/-/team/${inputs.org}/${inputs.team}/package`, {
    method: 'PUT',
    body: JSON.stringify({ package: inputs.pkg, permissions: inputs.permissions }),
  });
}

const npmTeamPackageProvider: pulumi.dynamic.ResourceProvider = {
  async create(
    inputs: NpmTeamPackageInputs
  ): Promise<pulumi.dynamic.CreateResult<NpmTeamPackageInputs>> {
    await grantPackage(inputs);
    return { id: `${inputs.org}:${inputs.team}:${inputs.pkg}`, outs: inputs };
  },

  async read(
    id: string,
    props: NpmTeamPackageInputs
  ): Promise<pulumi.dynamic.ReadResult<NpmTeamPackageInputs>> {
    const packages = await npmFetch<Record<string, string>>(
      props.token,
      `/-/team/${props.org}/${props.team}/package?format=cli`
    );
    // The registry returns 'read'/'write' here, not the 'read-only'/
    // 'read-write' values it accepts on grant (verified against
    // registry.npmjs.org; the npm CLI does the same translation).
    const fromRegistry: Record<string, NpmPermission> = {
      read: 'read-only',
      write: 'read-write',
    };
    const actual: NpmPermission | undefined = fromRegistry[packages[props.pkg] ?? ''];
    if (actual !== props.permissions) {
      // Self-heal permission drift (see NpmTeamUser.read for rationale)
      await grantPackage(props);
    }
    return { id, props };
  },

  async diff(_id: string, olds: NpmTeamPackageInputs, news: NpmTeamPackageInputs) {
    // org/team/pkg identify the grant - changing any of them must go through
    // delete-then-create so the old grant is actually revoked (an update
    // would only add the new one). Permission changes update in place.
    const replaces: string[] = [];
    if (olds.org !== news.org) replaces.push('org');
    if (olds.team !== news.team) replaces.push('team');
    if (olds.pkg !== news.pkg) replaces.push('pkg');
    return {
      changes:
        replaces.length > 0 || olds.permissions !== news.permissions || olds.token !== news.token,
      replaces,
      deleteBeforeReplace: true,
    };
  },

  async update(
    id: string,
    _olds: NpmTeamPackageInputs,
    news: NpmTeamPackageInputs
  ): Promise<pulumi.dynamic.UpdateResult<NpmTeamPackageInputs>> {
    await grantPackage(news);
    return { outs: news };
  },

  async delete(id: string, props: NpmTeamPackageInputs): Promise<void> {
    try {
      await npmFetch<void>(props.token, `/-/team/${props.org}/${props.team}/package`, {
        method: 'DELETE',
        body: JSON.stringify({ package: props.pkg }),
      });
    } catch (error) {
      console.warn(`Failed to revoke npm package access ${id}: ${error}`);
    }
  },
};

class NpmTeamPackage extends pulumi.dynamic.Resource {
  constructor(
    name: string,
    args: {
      org: pulumi.Input<string>;
      team: pulumi.Input<string>;
      pkg: pulumi.Input<string>;
      permissions: pulumi.Input<NpmPermission>;
      token: pulumi.Input<string>;
    },
    opts?: pulumi.CustomResourceOptions
  ) {
    super(npmTeamPackageProvider, name, args, opts);
  }
}

// ===================
// Wiring
// ===================
const roleLookup = buildRoleLookup();
// npm teams keyed by npm team name (matches npmPackages.ts references)
const npmTeams: Record<string, NpmTeam> = {};

if (NPM_ENABLED) {
  const token = NPM_TOKEN!;

  // Create npm teams for roles that have npm config
  ROLES.forEach((role: Role) => {
    if (!role.npm) return;

    npmTeams[role.npm.team] = new NpmTeam(`npm-team-${role.id}`, {
      org: NPM_ORG,
      team: role.npm.team,
      description: role.description + ' (Managed by github.com/modelcontextprotocol/access)',
      token,
    });
  });

  // Sync team memberships for members with an npm username
  MEMBERS.forEach((member) => {
    if (!member.npm) return;

    member.memberOf.forEach((roleId: RoleId) => {
      const role = roleLookup.get(roleId);
      if (!role?.npm) return; // Role doesn't have npm config

      new NpmTeamUser(
        `npm-team-user-${member.npm}-${role.npm.team}`,
        {
          org: NPM_ORG,
          team: role.npm.team,
          user: member.npm!,
          token,
        },
        { dependsOn: [npmTeams[role.npm.team]] }
      );
    });
  });

  // Configure package access
  NPM_PACKAGE_ACCESS.forEach((pkg) => {
    pkg.teams.forEach((teamAccess) => {
      const teamResource = npmTeams[teamAccess.team];
      if (!teamResource) {
        // validate-config.ts catches this in CI; fail clearly if it slips through
        throw new Error(
          `npmPackages.ts references npm team "${teamAccess.team}" which no role in roles.ts defines`
        );
      }

      new NpmTeamPackage(
        `npm-package-${teamAccess.team}-${pkg.package}`,
        {
          org: NPM_ORG,
          team: teamAccess.team,
          pkg: pkg.package,
          permissions: teamAccess.permission,
          token,
        },
        { dependsOn: [teamResource] }
      );
    });
  });
}

export { npmTeams };
