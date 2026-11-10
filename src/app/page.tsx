import { redirect } from "next/navigation";

/** The home page is the list of pages. */
export default function Home() {
  redirect("/pages");
}
