import type { Metadata } from "next";
import { ConsoleApp } from "@/components/console-app";

export const metadata: Metadata = { title: "Operator console · Reply Desk" };

export default function Page() {
  return <ConsoleApp />;
}
