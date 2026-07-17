import { createHash } from "node:crypto";

import type { BridgeConfig } from "./config.js";
import type { CodexProject } from "./project-registry.js";
import { canAccessProject, roleForSender, roleLabel } from "./team-policy.js";
import type { TeamRole } from "./types.js";

export interface TeamMember {
  id: string;
  selector: string;
  label: string;
  role: TeamRole;
}

export function memberSelector(memberId: string): string {
  return createHash("sha256")
    .update(`feishu-codex-member:${memberId}`)
    .digest("hex")
    .slice(0, 20);
}

export function memberLabel(config: BridgeConfig, memberId: string): string {
  const configured = config.memberLabels.get(memberId)?.trim();
  if (configured) return configured;
  return `成员 ${memberSelector(memberId).slice(0, 6).toLocaleUpperCase()}`;
}

export function teamMembers(config: BridgeConfig): TeamMember[] {
  const ids = new Set([
    ...config.adminSenderIds,
    ...config.allowedSenderIds,
    ...config.viewerSenderIds,
  ]);
  return [...ids]
    .map((id) => {
      const role = roleForSender(config, id);
      if (!role) return null;
      return {
        id,
        selector: memberSelector(id),
        label: memberLabel(config, id),
        role,
      } satisfies TeamMember;
    })
    .filter((member): member is TeamMember => member !== null)
    .sort((left, right) => {
      const roleOrder = roleRank(left.role) - roleRank(right.role);
      return roleOrder || left.label.localeCompare(right.label, "zh-CN");
    });
}

export function operatingTeamMembers(
  config: BridgeConfig,
  project?: Pick<CodexProject, "path" | "name" | "displayPath">,
): TeamMember[] {
  return teamMembers(config).filter(
    (member) =>
      member.role !== "viewer" && (!project || canAccessProject(config, member.id, project)),
  );
}

export function resolveMemberSelector(
  config: BridgeConfig,
  selector: string,
): TeamMember | undefined {
  return teamMembers(config).find((member) => member.selector === selector);
}

export function teamMemberOptionLabel(member: TeamMember): string {
  return `${member.label} · ${roleLabel(member.role)}`;
}

function roleRank(role: TeamRole): number {
  if (role === "admin") return 0;
  if (role === "operator") return 1;
  return 2;
}
