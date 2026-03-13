import { redirect } from "next/navigation";

export default async function BuildPage({
  searchParams
}: {
  searchParams: Promise<{ template?: string }>;
}) {
  const params = await searchParams;
  const template = params.template;
  if (template) {
    redirect(`/workspace?template=${encodeURIComponent(template)}`);
  }
  redirect("/workspace");
}
