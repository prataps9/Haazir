import { JharokhaArch, PrimaryCTA } from './Brand'

export default function CallToAction() {
  return (
    <section className="bg-paper px-5 pt-2 pb-20 sm:px-8 sm:pb-28">
      <div className="relative mx-auto max-w-[1180px] overflow-hidden rounded-[2rem] bg-forest px-6 py-16 text-paper sm:px-12 sm:py-24">
        <JharokhaArch
          className="pointer-events-none absolute -right-10 -bottom-16 h-[22rem] w-[22rem] text-paper/[0.05] sm:-right-4 sm:h-[30rem] sm:w-[30rem]"
          aria-hidden="true"
        />

        <div className="relative max-w-[40rem]">
          <h2 className="text-[clamp(2.3rem,5.6vw,4rem)] leading-[0.98]">
            Send us the last enquiry you missed.
          </h2>
          <p className="mt-6 max-w-[34rem] text-[1.1rem] text-paper/80">
            Screenshot it, forward it, or just tell us what happened. We'll reply with
            what the agent would have said — and what it would take to build.
          </p>

          <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center">
            <PrimaryCTA context="missed" tone="light" className="shrink-0 px-7 py-4 whitespace-nowrap">
              Message haazir on WhatsApp
            </PrimaryCTA>
            <p className="text-[0.92rem] text-paper/75">
              We answer in Hindi or English, usually within the hour.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
