import { Slider as SliderPrimitive } from "@base-ui/react/slider";

import { cn } from "~/lib/utils";

function Slider({ className, ...props }: SliderPrimitive.Root.Props) {
  return (
    <SliderPrimitive.Root
      className={cn("data-disabled:opacity-64", className)}
      data-slot="slider"
      {...props}
    >
      <SliderPrimitive.Control className="flex h-5 w-full touch-none select-none items-center">
        <SliderPrimitive.Track className="relative h-1 w-full grow rounded-full bg-input">
          <SliderPrimitive.Indicator className="rounded-full bg-primary" />
          <SliderPrimitive.Thumb className="size-3.5 rounded-full border border-primary bg-background shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

export { Slider };
