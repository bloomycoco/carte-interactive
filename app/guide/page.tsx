import type { Metadata } from "next";
import GuideView from "@/components/GuideView";

export const metadata: Metadata = {
  title: "Guide du Commandant — Atlas Galactique",
  description: "Tout savoir pour mener sa flotte à travers la galaxie : camps, déplacements, rencontres, sièges de planète.",
};

export default function GuidePage() {
  return <GuideView />;
}
