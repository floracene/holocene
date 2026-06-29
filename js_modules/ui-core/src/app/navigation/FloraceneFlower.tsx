// The Floracene brand mark: a cute six-petal flower. Drawn parametrically so the
// same shape can sit inside the square logo and the wide wordmark SVGs.

interface FlowerProps {
  cx: number;
  cy: number;
  r: number;
  petalColor: string;
  centerColor: string;
}

const PETAL_ANGLES = [0, 60, 120, 180, 240, 300];

export const FlowerPaths = ({cx, cy, r, petalColor, centerColor}: FlowerProps) => {
  const petalRx = r * 0.34;
  const petalRy = r * 0.62;
  const petalCy = cy - r * 0.55;
  return (
    <g>
      {PETAL_ANGLES.map((angle) => (
        <ellipse
          key={angle}
          cx={cx}
          cy={petalCy}
          rx={petalRx}
          ry={petalRy}
          fill={petalColor}
          transform={`rotate(${angle} ${cx} ${cy})`}
        />
      ))}
      <circle cx={cx} cy={cy} r={r * 0.36} fill={centerColor} />
    </g>
  );
};

export const FloraceneFlower = ({
  petalColor,
  centerColor,
}: {
  petalColor: string;
  centerColor: string;
}) => (
  <svg
    width="560"
    height="560"
    viewBox="0 0 560 560"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <FlowerPaths cx={280} cy={280} r={186} petalColor={petalColor} centerColor={centerColor} />
  </svg>
);
