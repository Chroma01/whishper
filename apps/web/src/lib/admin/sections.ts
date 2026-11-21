import type { IconName } from "#lib/components/icon-names.ts";

export type AdminSection = {
  href: string;
  label: string;
  icon: IconName;
};

export type AdminSectionGroup = {
  label: string;
  sections: AdminSection[];
};

// What people use first, then what keeps the server running.
export const ADMIN_SECTION_GROUPS: AdminSectionGroup[] = [
  {
    label: "Features",
    sections: [
      {
        href: "/admin/transcription",
        label: "Transcription",
        icon: "subtitles",
      },
      { href: "/admin/translation", label: "Translation", icon: "languages" },
    ],
  },
  {
    label: "System",
    sections: [
      { href: "/admin/providers", label: "External providers", icon: "globe" },
      { href: "/admin/workers", label: "Workers", icon: "server" },
      { href: "/admin/storage", label: "Storage", icon: "hard-drive" },
    ],
  },
];

export const ADMIN_HOME = "/admin/transcription";
