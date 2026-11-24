import { useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Header } from "@/components/Header";
import { ClientView } from "@/views/ClientView";
import { TherapistView } from "@/views/TherapistView";
import { usePath } from "@/hooks/use-path";
import { useTherapist } from "@/lib/queries";

export default function App() {
  const path = usePath();
  const isTherapist = path.replace(/\/+$/, "") === "/therapist";
  const { data } = useTherapist();
  const name = data?.therapist.name;

  useEffect(() => {
    document.title = isTherapist ? `Schedule${name ? ` · ${name}` : ""}` : name ? `Book with ${name}` : "Book a session";
  }, [isTherapist, name]);

  return (
    <TooltipProvider delayDuration={150}>
      <div className="min-h-dvh overflow-x-hidden">
        <Header isTherapist={isTherapist} />
        <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6">
          {isTherapist ? <TherapistView /> : <ClientView />}
        </main>
      </div>
      <Toaster position="top-center" />
    </TooltipProvider>
  );
}
