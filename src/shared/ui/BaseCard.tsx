import { Card, type CardProps } from "@mantine/core";
import type { ReactNode } from "react";

interface BaseCardProps extends Omit<CardProps, "children"> {
  children: ReactNode;
}

export function BaseCard({ children, ...rest }: BaseCardProps) {
  return (
    <Card shadow="sm" p="lg" withBorder radius="md" {...rest}>
      {children}
    </Card>
  );
}
