import type {
  ExerciseBodyPosition,
  ExerciseDifficulty,
  ExerciseEquipmentType,
  ExerciseGrip,
  ExerciseGripWidth,
  ExerciseLaterality,
  ExerciseMachineType,
  ExerciseMovementPattern,
  ExerciseMovementPlane,
  ExerciseMovementType,
  ExerciseResistanceType,
  OneRmSuitability,
} from '../src/generated/prisma/client';

export type MuscleGroupSeed = { key: string; name: string; description: string };

export type ExerciseSeed = {
  catalogKey: string;
  aliases?: string[];
  featuredRank?: number;
  name: string;
  primaryMuscleGroupKey: string;
  secondaryMuscleGroupKeys: string[];
  equipment: string;
  equipmentType: ExerciseEquipmentType;
  machineType: ExerciseMachineType | null;
  resistanceType: ExerciseResistanceType;
  movementType: ExerciseMovementType;
  movementPattern: ExerciseMovementPattern;
  grip: ExerciseGrip | null;
  gripWidth: ExerciseGripWidth | null;
  bodyPosition: ExerciseBodyPosition | null;
  laterality: ExerciseLaterality;
  movementPlane: ExerciseMovementPlane;
  difficulty: ExerciseDifficulty;
  oneRmSuitability: OneRmSuitability;
  description: string;
  instructions: string;
};

export const muscleGroups: MuscleGroupSeed[] = [
  { key: 'pectorales', name: 'Pectorales', description: 'Músculos del pecho que participan en empujes y aducción del hombro.' },
  { key: 'dorsales', name: 'Dorsales', description: 'Dorsal ancho y musculatura que contribuye a la extensión y aducción del hombro.' },
  { key: 'espalda-alta', name: 'Espalda alta', description: 'Romboides y musculatura escapular de la región torácica superior.' },
  { key: 'trapecio', name: 'Trapecio', description: 'Porciones superior, media e inferior del trapecio.' },
  { key: 'deltoides', name: 'Deltoides', description: 'Porciones anterior, lateral y posterior del deltoides.' },
  { key: 'biceps', name: 'Bíceps', description: 'Bíceps braquial y músculos flexores del codo asociados.' },
  { key: 'triceps', name: 'Tríceps', description: 'Tríceps braquial, principal extensor del codo.' },
  { key: 'antebrazos', name: 'Antebrazos', description: 'Flexores, extensores y músculos de rotación del antebrazo.' },
  { key: 'abdominales', name: 'Abdominales', description: 'Recto abdominal y musculatura anterior del tronco.' },
  { key: 'oblicuos', name: 'Oblicuos', description: 'Oblicuos interno y externo, implicados en rotación y control lateral.' },
  { key: 'erectores-espinales', name: 'Erectores espinales', description: 'Músculos que contribuyen a la extensión y estabilización de la columna.' },
  { key: 'gluteos', name: 'Glúteos', description: 'Glúteos mayor, medio y menor, según la variante.' },
  { key: 'cuadriceps', name: 'Cuádriceps', description: 'Grupo extensor de la rodilla en la cara anterior del muslo.' },
  { key: 'isquiotibiales', name: 'Isquiotibiales', description: 'Grupo posterior del muslo que flexiona la rodilla y extiende la cadera.' },
  { key: 'aductores', name: 'Aductores', description: 'Músculos de la cara medial del muslo.' },
  { key: 'abductores', name: 'Abductores', description: 'Músculos que separan el muslo de la línea media, incluido el glúteo medio.' },
  { key: 'gemelos', name: 'Gemelos', description: 'Gastrocnemio, músculo biarticular de la pantorrilla.' },
  { key: 'soleo', name: 'Sóleo', description: 'Músculo profundo de la pantorrilla, activo en la flexión plantar.' },
  { key: 'flexores-cadera', name: 'Flexores de cadera', description: 'Iliopsoas y musculatura que eleva el muslo.' },
  { key: 'serrato-anterior', name: 'Serrato anterior', description: 'Músculo que controla la protracción y rotación de la escápula.' },
];

type Variant = {
  instructions?: string;
  description?: string;
  key: string;
  name: string;
  equipment: string;
  equipmentType: ExerciseEquipmentType;
  resistanceType: ExerciseResistanceType;
  primary?: string;
  secondary?: string[];
  movementType?: ExerciseMovementType;
  pattern?: ExerciseMovementPattern;
  plane?: ExerciseMovementPlane;
  machineType?: ExerciseMachineType;
  grip?: ExerciseGrip;
  gripWidth?: ExerciseGripWidth;
  bodyPosition?: ExerciseBodyPosition;
  laterality?: ExerciseLaterality;
  difficulty?: ExerciseDifficulty;
  oneRmSuitability?: OneRmSuitability;
};

type Family = {
  key: string;
  primary: string;
  secondary: string[];
  movementType: ExerciseMovementType;
  pattern: ExerciseMovementPattern;
  plane: ExerciseMovementPlane;
  difficulty: ExerciseDifficulty;
  oneRmSuitability: OneRmSuitability;
  description: string;
  instructions: string;
  variants: Variant[];
};

const v = (
  key: string,
  name: string,
  equipment: string,
  equipmentType: ExerciseEquipmentType,
  resistanceType: ExerciseResistanceType,
  options: Omit<Variant, 'key' | 'name' | 'equipment' | 'equipmentType' | 'resistanceType'> = {},
): Variant => ({ key, name, equipment, equipmentType, resistanceType, ...options });

const families: Family[] = [
  {
    key: 'press-banca', primary: 'pectorales', secondary: ['triceps', 'deltoides'], movementType: 'COMPOUND', pattern: 'HORIZONTAL_PUSH', plane: 'TRANSVERSE', difficulty: 'BEGINNER', oneRmSuitability: 'SUITABLE',
    description: 'Empuje horizontal que carga principalmente el pecho; la posición, el ángulo y el agarre cambian la contribución del tríceps y del hombro.',
    instructions: 'Mantén los pies apoyados y las escápulas estables. Desciende con control hasta un rango cómodo y empuja sin perder la trayectoria.',
    variants: [
      v('floor-press-barra', 'Press de suelo con barra', 'Barra olímpica y soportes bajos', 'BARBELL', 'FREE_WEIGHT', {bodyPosition:'SUPINE',grip:'PRONATED', instructions:'Apoya suavemente los tríceps en el suelo, pausa sin rebotar y extiende los codos manteniendo las muñecas alineadas.'}),
      v('floor-press-mancuernas', 'Press de suelo con mancuernas', 'Mancuernas', 'DUMBBELL', 'FREE_WEIGHT', {bodyPosition:'SUPINE',grip:'NEUTRAL'}),
      v('unilateral-polea-de-pie', 'Press unilateral de pecho de pie en polea', 'Polea ajustable y maneral', 'CABLE', 'CABLE', {machineType:'CABLE',bodyPosition:'STANDING',laterality:'UNILATERAL',oneRmSuitability:'NOT_SUITABLE'}),
      v('barra-plano', 'Press de banca plano con barra olímpica', 'Barra olímpica y banco plano', 'BARBELL', 'FREE_WEIGHT', { grip: 'PRONATED', gripWidth: 'SHOULDER_WIDTH', bodyPosition: 'SUPINE', oneRmSuitability: 'SUITABLE' }),
      v('barra-inclinado', 'Press de banca inclinado con barra olímpica', 'Barra olímpica y banco inclinado', 'BARBELL', 'FREE_WEIGHT', { grip: 'PRONATED', gripWidth: 'SHOULDER_WIDTH', bodyPosition: 'SUPINE', difficulty: 'INTERMEDIATE', oneRmSuitability: 'SUITABLE' }),
      v('barra-declinado', 'Press de banca declinado con barra olímpica', 'Barra olímpica y banco declinado', 'BARBELL', 'FREE_WEIGHT', { grip: 'PRONATED', gripWidth: 'SHOULDER_WIDTH', bodyPosition: 'SUPINE', difficulty: 'INTERMEDIATE', oneRmSuitability: 'SUITABLE' }),
      v('barra-agarre-cerrado', 'Press de banca con agarre cerrado', 'Barra olímpica y banco plano', 'BARBELL', 'FREE_WEIGHT', { grip: 'PRONATED', gripWidth: 'NARROW', bodyPosition: 'SUPINE', difficulty: 'INTERMEDIATE', oneRmSuitability: 'SUITABLE' }),
      v('ez-inclinado', 'Press inclinado con barra EZ', 'Barra EZ y banco inclinado', 'EZ_BAR', 'FREE_WEIGHT', { grip: 'PRONATED', gripWidth: 'VARIABLE', bodyPosition: 'SUPINE', difficulty: 'INTERMEDIATE' }),
      v('mancuernas-plano', 'Press plano con mancuernas', 'Mancuernas y banco plano', 'DUMBBELL', 'FREE_WEIGHT', { grip: 'PRONATED', gripWidth: 'VARIABLE', bodyPosition: 'SUPINE', laterality: 'ALTERNATING', oneRmSuitability: 'SUITABLE' }),
      v('mancuernas-neutro', 'Press plano con mancuernas y agarre neutro', 'Mancuernas y banco plano', 'DUMBBELL', 'FREE_WEIGHT', { grip: 'NEUTRAL', gripWidth: 'VARIABLE', bodyPosition: 'SUPINE', laterality: 'BILATERAL' }),
      v('mancuernas-inclinado', 'Press inclinado con mancuernas', 'Mancuernas y banco inclinado', 'DUMBBELL', 'FREE_WEIGHT', { grip: 'PRONATED', gripWidth: 'VARIABLE', bodyPosition: 'SUPINE', oneRmSuitability: 'SUITABLE' }),
      v('smith-plano', 'Press de banca plano en máquina Smith', 'Máquina Smith y banco plano', 'SMITH_MACHINE', 'PLATE_LOADED', { machineType: 'SMITH', grip: 'PRONATED', gripWidth: 'SHOULDER_WIDTH', bodyPosition: 'SUPINE' }),
      v('smith-inclinado', 'Press inclinado en máquina Smith', 'Máquina Smith y banco inclinado', 'SMITH_MACHINE', 'PLATE_LOADED', { machineType: 'SMITH', grip: 'PRONATED', gripWidth: 'SHOULDER_WIDTH', bodyPosition: 'SUPINE' }),
      v('maquina-selectorizada', 'Press de pecho en máquina selectorizada', 'Máquina de pecho selectorizada', 'MACHINE', 'WEIGHT_STACK', { machineType: 'SELECTORIZED', bodyPosition: 'SEATED' }),
      v('maquina-convergente', 'Press convergente de pecho en máquina', 'Máquina convergente cargada con discos', 'MACHINE', 'PLATE_LOADED', { machineType: 'CONVERGING', bodyPosition: 'SEATED' }),
    ],
  },
  {
    key: 'apertura-pecho', primary: 'pectorales', secondary: ['deltoides'], movementType: 'ISOLATION', pattern: 'HORIZONTAL_PUSH', plane: 'TRANSVERSE', difficulty: 'BEGINNER', oneRmSuitability: 'NOT_SUITABLE',
    description: 'Aducción horizontal del hombro con codos ligeramente flexionados; el recorrido se adapta a la movilidad individual.',
    instructions: 'Conserva una flexión suave del codo y evita que los hombros se desplacen hacia delante al final del recorrido.',
    variants: [
      v('mancuernas-plano', 'Apertura con mancuernas en banco plano', 'Mancuernas y banco plano', 'DUMBBELL', 'FREE_WEIGHT', { grip: 'NEUTRAL', bodyPosition: 'SUPINE' }),
      v('mancuernas-inclinado', 'Apertura con mancuernas en banco inclinado', 'Mancuernas y banco inclinado', 'DUMBBELL', 'FREE_WEIGHT', { grip: 'NEUTRAL', bodyPosition: 'SUPINE' }),
      v('polea-media', 'Cruce de poleas a la altura del pecho', 'Poleas ajustables y manerales', 'CABLE', 'CABLE', { machineType: 'CABLE', grip: 'NEUTRAL', bodyPosition: 'STANDING' }),
      v('polea-alta', 'Cruce de poleas de arriba hacia abajo', 'Polea alta y manerales', 'CABLE', 'CABLE', { machineType: 'CABLE', grip: 'NEUTRAL', bodyPosition: 'STANDING' }),
      v('polea-baja', 'Cruce de poleas de abajo hacia arriba', 'Polea baja y manerales', 'CABLE', 'CABLE', { machineType: 'CABLE', grip: 'NEUTRAL', bodyPosition: 'STANDING' }),
      v('polea-unilateral', 'Apertura unilateral en polea', 'Polea ajustable y maneral individual', 'CABLE', 'CABLE', { machineType: 'CABLE', grip: 'NEUTRAL', bodyPosition: 'STANDING', laterality: 'UNILATERAL' }),
      v('pec-deck', 'Apertura de pecho en máquina pec deck', 'Máquina pec deck selectorizada', 'MACHINE', 'WEIGHT_STACK', { machineType: 'SELECTORIZED', bodyPosition: 'SEATED' }),
      v('maquina-convergente', 'Apertura convergente en máquina', 'Máquina convergente de pecho', 'MACHINE', 'PLATE_LOADED', { machineType: 'CONVERGING', bodyPosition: 'SEATED' }),
    ],
  },
  {
    key: 'flexion-brazos', primary: 'pectorales', secondary: ['triceps', 'deltoides', 'serrato-anterior'], movementType: 'COMPOUND', pattern: 'HORIZONTAL_PUSH', plane: 'TRANSVERSE', difficulty: 'BEGINNER', oneRmSuitability: 'NOT_SUITABLE',
    description: 'Empuje de peso corporal con el tronco alineado; la altura de las manos o de los pies modifica la demanda.',
    instructions: 'Mantén cabeza, tronco y pelvis alineados. Desciende hasta un rango controlado y separa el suelo con las manos.',
    variants: [
      v('suelo', 'Flexión de brazos en el suelo', 'Peso corporal', 'BODYWEIGHT', 'BODYWEIGHT', { bodyPosition: 'PRONE', laterality: 'BILATERAL' }),
      v('manos-elevadas', 'Flexión de brazos con manos elevadas', 'Peso corporal y soporte estable', 'BODYWEIGHT', 'BODYWEIGHT', { bodyPosition: 'PRONE' }),
      v('pies-elevados', 'Flexión de brazos con pies elevados', 'Peso corporal y banco', 'BODYWEIGHT', 'BODYWEIGHT', { bodyPosition: 'PRONE', difficulty: 'INTERMEDIATE' }),
      v('anillas', 'Flexión de brazos en anillas', 'Anillas de gimnasia', 'RINGS', 'BODYWEIGHT', { bodyPosition: 'PRONE', difficulty: 'INTERMEDIATE' }),
      v('lastre', 'Flexión de brazos con lastre', 'Peso corporal y chaleco lastrado', 'BODYWEIGHT', 'BODYWEIGHT', { bodyPosition: 'PRONE', difficulty: 'ADVANCED' }),
      v('diamante', 'Flexión de brazos con manos juntas', 'Peso corporal', 'BODYWEIGHT', 'BODYWEIGHT', { gripWidth: 'NARROW', bodyPosition: 'PRONE', difficulty: 'INTERMEDIATE' }),
      v('balon-medicinal', 'Flexión de brazos con manos sobre balón medicinal', 'Balón medicinal', 'MEDICINE_BALL', 'BODYWEIGHT', { bodyPosition: 'PRONE', difficulty: 'ADVANCED' }),
    ],
  },
  {
    key: 'fondos', primary: 'triceps', secondary: ['pectorales', 'deltoides'], movementType: 'COMPOUND', pattern: 'VERTICAL_PUSH', plane: 'SAGITTAL', difficulty: 'INTERMEDIATE', oneRmSuitability: 'NOT_SUITABLE',
    description: 'Extensión del codo en apoyo; la inclinación del tronco cambia la contribución del pecho.',
    instructions: 'Controla el descenso y limita el rango si aparece molestia en el hombro. Mantén los apoyos estables.',
    variants: [
      v('paralelas', 'Fondos en barras paralelas', 'Barras paralelas', 'BODYWEIGHT', 'BODYWEIGHT', { grip: 'NEUTRAL', bodyPosition: 'STANDING' }),
      v('paralelas-lastreados', 'Fondos lastrados en barras paralelas', 'Barras paralelas y cinturón lastrado', 'BODYWEIGHT', 'BODYWEIGHT', { grip: 'NEUTRAL', bodyPosition: 'STANDING', difficulty: 'ADVANCED' }),
      v('asistidos', 'Fondos asistidos en máquina', 'Máquina de fondos asistidos', 'MACHINE', 'WEIGHT_STACK', { machineType: 'SELECTORIZED', grip: 'NEUTRAL', bodyPosition: 'STANDING' }),
      v('banco', 'Fondos de tríceps en banco', 'Banco plano', 'BODYWEIGHT', 'BODYWEIGHT', { bodyPosition: 'SEATED', difficulty: 'BEGINNER' }),
    ],
  },
  {
    key: 'press-vertical', primary: 'deltoides', secondary: ['triceps', 'trapecio'], movementType: 'COMPOUND', pattern: 'VERTICAL_PUSH', plane: 'SAGITTAL', difficulty: 'INTERMEDIATE', oneRmSuitability: 'UNDETERMINED',
    description: 'Empuje vertical desde hombros; requiere control del tronco y un rango cómodo de elevación.',
    instructions: 'Mantén las costillas controladas y empuja sobre la cabeza sin arquear la zona lumbar.',
    variants: [
      v('barra-de-pie', 'Press militar de pie con barra olímpica', 'Barra olímpica', 'BARBELL', 'FREE_WEIGHT', { grip: 'PRONATED', gripWidth: 'SHOULDER_WIDTH', bodyPosition: 'STANDING', oneRmSuitability: 'SUITABLE' }),
      v('barra-sentado', 'Press militar sentado con barra', 'Barra olímpica y banco con respaldo', 'BARBELL', 'FREE_WEIGHT', { grip: 'PRONATED', gripWidth: 'SHOULDER_WIDTH', bodyPosition: 'SEATED', oneRmSuitability: 'SUITABLE' }),
      v('mancuernas-sentado', 'Press de hombros sentado con mancuernas', 'Mancuernas y banco con respaldo', 'DUMBBELL', 'FREE_WEIGHT', { grip: 'PRONATED', bodyPosition: 'SEATED' }),
      v('mancuernas-neutro', 'Press de hombros con agarre neutro', 'Mancuernas y banco con respaldo', 'DUMBBELL', 'FREE_WEIGHT', { grip: 'NEUTRAL', bodyPosition: 'SEATED' }),
      v('arnold', 'Press Arnold con mancuernas', 'Mancuernas y banco con respaldo', 'DUMBBELL', 'FREE_WEIGHT', { grip: 'VARIABLE', bodyPosition: 'SEATED', difficulty: 'INTERMEDIATE' }),
      v('smith', 'Press de hombros en máquina Smith', 'Máquina Smith y banco', 'SMITH_MACHINE', 'PLATE_LOADED', { machineType: 'SMITH', grip: 'PRONATED', bodyPosition: 'SEATED' }),
      v('maquina-selectorizada', 'Press de hombros en máquina selectorizada', 'Máquina de hombros selectorizada', 'MACHINE', 'WEIGHT_STACK', { machineType: 'SELECTORIZED', bodyPosition: 'SEATED' }),
      v('maquina-convergente', 'Press convergente de hombros', 'Máquina convergente cargada con discos', 'MACHINE', 'PLATE_LOADED', { machineType: 'CONVERGING', bodyPosition: 'SEATED' }),
    ],
  },
  {
    key: 'elevacion-lateral', primary: 'deltoides', secondary: ['trapecio'], movementType: 'ISOLATION', pattern: 'SHOULDER_ABDUCTION', plane: 'FRONTAL', difficulty: 'BEGINNER', oneRmSuitability: 'NOT_SUITABLE',
    description: 'Abducción del hombro para trabajar sobre todo la porción lateral del deltoides.',
    instructions: 'Eleva los brazos en un plano cómodo, con control y sin impulso del tronco.',
    variants: [
      v('polea-tumbado', 'Elevación lateral tumbado en polea', 'Polea baja y banco plano', 'CABLE', 'CABLE', {machineType:'CABLE',bodyPosition:'SUPINE',laterality:'UNILATERAL'}),
      v('mancuernas-de-pie', 'Elevación lateral con mancuernas de pie', 'Mancuernas', 'DUMBBELL', 'FREE_WEIGHT', { grip: 'NEUTRAL', bodyPosition: 'STANDING' }),
      v('mancuernas-sentado', 'Elevación lateral con mancuernas sentado', 'Mancuernas y banco', 'DUMBBELL', 'FREE_WEIGHT', { grip: 'NEUTRAL', bodyPosition: 'SEATED' }),
      v('polea-unilateral', 'Elevación lateral unilateral en polea baja', 'Polea baja y maneral', 'CABLE', 'CABLE', { machineType: 'CABLE', grip: 'NEUTRAL', bodyPosition: 'STANDING', laterality: 'UNILATERAL' }),
      v('polea-cruzada', 'Elevación lateral cruzada en polea', 'Polea baja y maneral individual', 'CABLE', 'CABLE', { machineType: 'CABLE', grip: 'NEUTRAL', bodyPosition: 'STANDING', laterality: 'UNILATERAL' }),
      v('maquina', 'Elevación lateral en máquina', 'Máquina de elevación lateral', 'MACHINE', 'WEIGHT_STACK', { machineType: 'SELECTORIZED', bodyPosition: 'SEATED' }),
      v('banda', 'Elevación lateral con banda elástica', 'Banda elástica', 'RESISTANCE_BAND', 'ELASTIC', { grip: 'NEUTRAL', bodyPosition: 'STANDING' }),
      v('inclinada', 'Elevación lateral inclinada con mancuerna', 'Mancuerna y soporte', 'DUMBBELL', 'FREE_WEIGHT', { grip: 'NEUTRAL', bodyPosition: 'SIDE_LYING', laterality: 'UNILATERAL' }),
    ],
  },
  {
    key: 'deltoide-posterior', primary: 'deltoides', secondary: ['espalda-alta', 'trapecio'], movementType: 'ISOLATION', pattern: 'HORIZONTAL_PULL', plane: 'TRANSVERSE', difficulty: 'BEGINNER', oneRmSuitability: 'NOT_SUITABLE',
    description: 'Abducción horizontal del hombro con énfasis en la porción posterior del deltoides.',
    instructions: 'Mueve los brazos sin encoger los hombros y conserva el tronco estable.',
    variants: [
      v('mancuernas-inclinado', 'Pájaro con mancuernas en banco inclinado', 'Mancuernas y banco inclinado', 'DUMBBELL', 'FREE_WEIGHT', { grip: 'NEUTRAL', bodyPosition: 'PRONE' }),
      v('mancuernas-de-pie', 'Pájaro con mancuernas de pie', 'Mancuernas', 'DUMBBELL', 'FREE_WEIGHT', { grip: 'NEUTRAL', bodyPosition: 'STANDING' }),
      v('polea-cruzada', 'Apertura posterior cruzada en polea', 'Poleas ajustables y manerales', 'CABLE', 'CABLE', { machineType: 'CABLE', grip: 'NEUTRAL', bodyPosition: 'STANDING' }),
      v('polea-unilateral', 'Apertura posterior unilateral en polea', 'Polea ajustable y maneral', 'CABLE', 'CABLE', { machineType: 'CABLE', grip: 'NEUTRAL', bodyPosition: 'STANDING', laterality: 'UNILATERAL' }),
      v('pec-deck-inverso', 'Apertura inversa en máquina pec deck', 'Máquina pec deck', 'MACHINE', 'WEIGHT_STACK', { machineType: 'SELECTORIZED', bodyPosition: 'SEATED' }),
      v('face-pull-cuerda', 'Face pull con cuerda', 'Polea alta y cuerda', 'CABLE', 'CABLE', { machineType: 'CABLE', grip: 'NEUTRAL', bodyPosition: 'STANDING' }),
      v('face-pull-banda', 'Face pull con banda elástica', 'Banda elástica anclada', 'RESISTANCE_BAND', 'ELASTIC', { grip: 'NEUTRAL', bodyPosition: 'STANDING' }),
    ],
  },
  {
    key: 'remo-horizontal', primary: 'espalda-alta', secondary: ['dorsales', 'biceps', 'trapecio'], movementType: 'COMPOUND', pattern: 'HORIZONTAL_PULL', plane: 'TRANSVERSE', difficulty: 'BEGINNER', oneRmSuitability: 'UNDETERMINED',
    description: 'Tracción hacia el torso; el apoyo del pecho reduce la demanda de estabilización del tronco.',
    instructions: 'Inicia con las escápulas controladas y dirige los codos según el objetivo de la variante. Evita tirones.',
    variants: [
      v('seal-mancuernas', 'Remo seal con mancuernas', 'Mancuernas y banco horizontal elevado', 'DUMBBELL', 'FREE_WEIGHT', {bodyPosition:'PRONE',grip:'NEUTRAL',instructions:'Mantén el pecho apoyado en el banco elevado. Lleva los codos atrás sin extender la zona lumbar.'}),
      v('meadows', 'Remo Meadows unilateral', 'Barra anclada en landmine', 'BARBELL', 'FREE_WEIGHT', {bodyPosition:'STANDING',grip:'PRONATED',laterality:'UNILATERAL',difficulty:'INTERMEDIATE'}),
      v('pecho-apoyado-polea', 'Remo en polea con pecho apoyado', 'Polea baja, banco inclinado y agarre neutro', 'CABLE', 'CABLE', {machineType:'CABLE',bodyPosition:'PRONE',grip:'NEUTRAL'}),
      v('barra-pronado', 'Remo inclinado con barra y agarre prono', 'Barra olímpica', 'BARBELL', 'FREE_WEIGHT', { grip: 'PRONATED', gripWidth: 'SHOULDER_WIDTH', bodyPosition: 'STANDING', oneRmSuitability: 'SUITABLE' }),
      v('barra-supino', 'Remo inclinado con barra y agarre supino', 'Barra olímpica', 'BARBELL', 'FREE_WEIGHT', { grip: 'SUPINATED', gripWidth: 'SHOULDER_WIDTH', bodyPosition: 'STANDING' }),
      v('pendlay', 'Remo Pendlay desde el suelo', 'Barra olímpica', 'BARBELL', 'FREE_WEIGHT', { grip: 'PRONATED', gripWidth: 'WIDE', bodyPosition: 'STANDING', difficulty: 'ADVANCED', oneRmSuitability: 'SUITABLE' }),
      v('mancuerna-unilateral', 'Remo unilateral con mancuerna', 'Mancuerna y banco', 'DUMBBELL', 'FREE_WEIGHT', { grip: 'NEUTRAL', bodyPosition: 'STANDING', laterality: 'UNILATERAL' }),
      v('mancuernas-pecho-apoyado', 'Remo con mancuernas con pecho apoyado', 'Mancuernas y banco inclinado', 'DUMBBELL', 'FREE_WEIGHT', { grip: 'NEUTRAL', bodyPosition: 'PRONE', laterality: 'BILATERAL' }),
      v('barra-t', 'Remo en barra T', 'Barra T y discos', 'LANDMINE', 'PLATE_LOADED', { grip: 'NEUTRAL', bodyPosition: 'STANDING', laterality: 'BILATERAL' }),
      v('maquina-pecho-apoyado', 'Remo con pecho apoyado en máquina', 'Máquina de remo selectorizada', 'MACHINE', 'WEIGHT_STACK', { machineType: 'SELECTORIZED', bodyPosition: 'PRONE' }),
      v('maquina-convergente', 'Remo convergente con pecho apoyado', 'Máquina convergente cargada con discos', 'MACHINE', 'PLATE_LOADED', { machineType: 'CONVERGING', bodyPosition: 'PRONE' }),
      v('polea-barra', 'Remo sentado en polea con barra recta', 'Polea baja y barra recta', 'CABLE', 'CABLE', { machineType: 'CABLE', grip: 'PRONATED', gripWidth: 'SHOULDER_WIDTH', bodyPosition: 'SEATED' }),
      v('polea-v', 'Remo sentado en polea con agarre V', 'Polea baja y agarre V', 'CABLE', 'CABLE', { machineType: 'CABLE', grip: 'NEUTRAL', gripWidth: 'NARROW', bodyPosition: 'SEATED' }),
      v('polea-cuerda', 'Remo sentado en polea con cuerda', 'Polea baja y cuerda', 'CABLE', 'CABLE', { machineType: 'CABLE', grip: 'NEUTRAL', bodyPosition: 'SEATED' }),
      v('polea-unilateral', 'Remo unilateral en polea baja', 'Polea baja y maneral individual', 'CABLE', 'CABLE', { machineType: 'CABLE', grip: 'NEUTRAL', bodyPosition: 'SEATED', laterality: 'UNILATERAL' }),
    ],
  },
  {
    key: 'traccion-vertical', primary: 'dorsales', secondary: ['biceps', 'espalda-alta', 'antebrazos'], movementType: 'COMPOUND', pattern: 'VERTICAL_PULL', plane: 'SAGITTAL', difficulty: 'INTERMEDIATE', oneRmSuitability: 'NOT_SUITABLE',
    description: 'Tracción vertical que aproxima los brazos al torso; se usan distintas anchuras y agarres.',
    instructions: 'Inicia el movimiento llevando los hombros hacia abajo y controla el retorno sin balancear el torso.',
    variants: [
      v('dominada-prona', 'Dominada con agarre prono', 'Barra fija', 'BODYWEIGHT', 'BODYWEIGHT', { grip: 'PRONATED', gripWidth: 'SHOULDER_WIDTH', bodyPosition: 'HANGING', difficulty: 'INTERMEDIATE' }),
      v('dominada-supina', 'Dominada con agarre supino', 'Barra fija', 'BODYWEIGHT', 'BODYWEIGHT', { grip: 'SUPINATED', gripWidth: 'SHOULDER_WIDTH', bodyPosition: 'HANGING' }),
      v('dominada-neutra', 'Dominada con agarre neutro', 'Barra fija con agarres neutros', 'BODYWEIGHT', 'BODYWEIGHT', { grip: 'NEUTRAL', gripWidth: 'SHOULDER_WIDTH', bodyPosition: 'HANGING' }),
      v('dominada-lastreadas', 'Dominada lastrada con agarre prono', 'Barra fija y cinturón lastrado', 'BODYWEIGHT', 'BODYWEIGHT', { grip: 'PRONATED', bodyPosition: 'HANGING', difficulty: 'ADVANCED' }),
      v('dominada-asistida', 'Dominada asistida en máquina', 'Máquina de dominadas asistidas', 'MACHINE', 'WEIGHT_STACK', { machineType: 'SELECTORIZED', grip: 'NEUTRAL', bodyPosition: 'HANGING', difficulty: 'BEGINNER' }),
      v('jalon-prono', 'Jalón al pecho con barra y agarre prono', 'Polea alta y barra larga', 'CABLE', 'CABLE', { machineType: 'CABLE', grip: 'PRONATED', gripWidth: 'WIDE', bodyPosition: 'SEATED' }),
      v('jalon-supino', 'Jalón al pecho con agarre supino', 'Polea alta y barra recta', 'CABLE', 'CABLE', { machineType: 'CABLE', grip: 'SUPINATED', gripWidth: 'SHOULDER_WIDTH', bodyPosition: 'SEATED' }),
      v('jalon-v', 'Jalón al pecho con agarre V', 'Polea alta y agarre V', 'CABLE', 'CABLE', { machineType: 'CABLE', grip: 'NEUTRAL', gripWidth: 'NARROW', bodyPosition: 'SEATED' }),
      v('jalon-cuerda', 'Jalón con brazos rectos y cuerda', 'Polea alta y cuerda', 'CABLE', 'CABLE', { machineType: 'CABLE', grip: 'NEUTRAL', bodyPosition: 'STANDING', movementType: 'ISOLATION' }),
      v('jalon-unilateral', 'Jalón unilateral en polea alta', 'Polea alta y maneral', 'CABLE', 'CABLE', { machineType: 'CABLE', grip: 'NEUTRAL', bodyPosition: 'SEATED', laterality: 'UNILATERAL' }),
    ],
  },
  {
    key: 'sentadilla', primary: 'cuadriceps', secondary: ['gluteos', 'aductores', 'erectores-espinales'], movementType: 'COMPOUND', pattern: 'SQUAT', plane: 'SAGITTAL', difficulty: 'INTERMEDIATE', oneRmSuitability: 'SUITABLE',
    description: 'Flexión coordinada de cadera y rodilla. La colocación de la carga y la postura modifican el reparto de demanda.',
    instructions: 'Mantén el apoyo del pie estable y desciende hasta un rango que puedas controlar sin dolor ni pérdida de equilibrio.',
    variants: [
      v('zercher', 'Sentadilla Zercher con barra', 'Barra olímpica y rack', 'BARBELL', 'FREE_WEIGHT', {bodyPosition:'STANDING',difficulty:'ADVANCED',oneRmSuitability:'UNDETERMINED',instructions:'Apoya la barra en los pliegues de los codos. Mantén el tronco estable y baja sin perder el equilibrio sobre el pie.'}),
      v('landmine', 'Sentadilla con barra en landmine', 'Barra anclada en landmine', 'BARBELL', 'FREE_WEIGHT', {bodyPosition:'STANDING',grip:'NEUTRAL',oneRmSuitability:'NOT_SUITABLE'}),
      v('barra-alta', 'Sentadilla trasera con barra alta', 'Barra olímpica y rack', 'BARBELL', 'FREE_WEIGHT', { grip: 'PRONATED', gripWidth: 'WIDE', bodyPosition: 'STANDING', oneRmSuitability: 'SUITABLE' }),
      v('barra-baja', 'Sentadilla trasera con barra baja', 'Barra olímpica y rack', 'BARBELL', 'FREE_WEIGHT', { grip: 'PRONATED', gripWidth: 'WIDE', bodyPosition: 'STANDING', difficulty: 'ADVANCED', oneRmSuitability: 'SUITABLE' }),
      v('frontal-barra', 'Sentadilla frontal con barra', 'Barra olímpica y rack', 'BARBELL', 'FREE_WEIGHT', { grip: 'PRONATED', gripWidth: 'SHOULDER_WIDTH', bodyPosition: 'STANDING', difficulty: 'ADVANCED', oneRmSuitability: 'SUITABLE' }),
      v('goblet-mancuerna', 'Sentadilla goblet con mancuerna', 'Mancuerna', 'DUMBBELL', 'FREE_WEIGHT', { grip: 'NEUTRAL', bodyPosition: 'STANDING', difficulty: 'BEGINNER' }),
      v('goblet-kettlebell', 'Sentadilla goblet con kettlebell', 'Kettlebell', 'KETTLEBELL', 'FREE_WEIGHT', { grip: 'NEUTRAL', bodyPosition: 'STANDING', difficulty: 'BEGINNER' }),
      v('smith', 'Sentadilla en máquina Smith', 'Máquina Smith', 'SMITH_MACHINE', 'PLATE_LOADED', { machineType: 'SMITH', bodyPosition: 'STANDING' }),
      v('hack', 'Sentadilla en máquina hack', 'Máquina hack cargada con discos', 'MACHINE', 'PLATE_LOADED', { machineType: 'HACK_SQUAT', bodyPosition: 'STANDING' }),
      v('pendulo', 'Sentadilla en máquina péndulo', 'Máquina péndulo', 'MACHINE', 'PLATE_LOADED', { machineType: 'LEVER', bodyPosition: 'STANDING' }),
      v('belt', 'Sentadilla con cinturón', 'Máquina de sentadilla con cinturón', 'MACHINE', 'PLATE_LOADED', { machineType: 'LEVER', bodyPosition: 'STANDING' }),
      v('banda', 'Sentadilla con banda elástica', 'Banda elástica', 'RESISTANCE_BAND', 'ELASTIC', { bodyPosition: 'STANDING', difficulty: 'BEGINNER' }),
      v('sentadilla-profunda', 'Sentadilla profunda con barra', 'Barra olímpica y rack', 'BARBELL', 'FREE_WEIGHT', { grip: 'PRONATED', gripWidth: 'WIDE', bodyPosition: 'STANDING', difficulty: 'ADVANCED', oneRmSuitability: 'SUITABLE' }),
      v('sentadilla-caja', 'Sentadilla a caja con barra', 'Barra olímpica, rack y caja', 'BARBELL', 'FREE_WEIGHT', { grip: 'PRONATED', gripWidth: 'WIDE', bodyPosition: 'STANDING', oneRmSuitability: 'SUITABLE' }),
    ],
  },
  {
    key: 'bisagra-cadera', primary: 'isquiotibiales', secondary: ['gluteos', 'erectores-espinales', 'antebrazos'], movementType: 'COMPOUND', pattern: 'HIP_HINGE', plane: 'SAGITTAL', difficulty: 'INTERMEDIATE', oneRmSuitability: 'UNDETERMINED',
    description: 'Bisagra de cadera con carga; la variante determina el rango, la posición de la barra y la demanda de agarre.',
    instructions: 'Lleva la cadera hacia atrás manteniendo la carga cerca del cuerpo. Evita forzar la columna al final del rango.',
    variants: [
      v('rumano-b-stance', 'Peso muerto rumano en apoyo escalonado con mancuernas', 'Mancuernas', 'DUMBBELL', 'FREE_WEIGHT', {bodyPosition:'STANDING',grip:'NEUTRAL',laterality:'UNILATERAL',instructions:'Coloca un pie ligeramente atrás como apoyo. Lleva las caderas hacia atrás cargando la pierna delantera y mantén la espalda estable.'}),
      v('peso-muerto-convencional', 'Peso muerto convencional con barra', 'Barra olímpica y discos', 'BARBELL', 'FREE_WEIGHT', { grip: 'MIXED', gripWidth: 'SHOULDER_WIDTH', bodyPosition: 'STANDING', oneRmSuitability: 'SUITABLE' }),
      v('peso-muerto-sumo', 'Peso muerto sumo con barra', 'Barra olímpica y discos', 'BARBELL', 'FREE_WEIGHT', { grip: 'MIXED', gripWidth: 'WIDE', bodyPosition: 'STANDING', difficulty: 'ADVANCED', oneRmSuitability: 'SUITABLE' }),
      v('rumano-barra', 'Peso muerto rumano con barra', 'Barra olímpica', 'BARBELL', 'FREE_WEIGHT', { grip: 'PRONATED', gripWidth: 'SHOULDER_WIDTH', bodyPosition: 'STANDING', oneRmSuitability: 'SUITABLE' }),
      v('rumano-mancuernas', 'Peso muerto rumano con mancuernas', 'Mancuernas', 'DUMBBELL', 'FREE_WEIGHT', { grip: 'NEUTRAL', bodyPosition: 'STANDING' }),
      v('rumano-unilateral', 'Peso muerto rumano unilateral con mancuerna', 'Mancuerna', 'DUMBBELL', 'FREE_WEIGHT', { grip: 'NEUTRAL', bodyPosition: 'STANDING', laterality: 'UNILATERAL', difficulty: 'INTERMEDIATE' }),
      v('trap-bar', 'Peso muerto con barra hexagonal', 'Barra hexagonal y discos', 'BARBELL', 'FREE_WEIGHT', { grip: 'NEUTRAL', gripWidth: 'SHOULDER_WIDTH', bodyPosition: 'STANDING', oneRmSuitability: 'SUITABLE' }),
      v('rack-pull', 'Peso muerto desde soportes', 'Barra olímpica y rack', 'BARBELL', 'FREE_WEIGHT', { grip: 'MIXED', gripWidth: 'SHOULDER_WIDTH', bodyPosition: 'STANDING', difficulty: 'ADVANCED', oneRmSuitability: 'UNDETERMINED' }),
      v('good-morning', 'Buenos días con barra', 'Barra olímpica y rack', 'BARBELL', 'FREE_WEIGHT', { grip: 'PRONATED', gripWidth: 'WIDE', bodyPosition: 'STANDING', difficulty: 'ADVANCED' }),
      v('pull-through', 'Pull-through en polea', 'Polea baja y cuerda', 'CABLE', 'CABLE', { machineType: 'CABLE', grip: 'NEUTRAL', bodyPosition: 'STANDING', movementType: 'COMPOUND' }),
      v('kettlebell', 'Peso muerto con kettlebell', 'Kettlebell', 'KETTLEBELL', 'FREE_WEIGHT', { grip: 'NEUTRAL', bodyPosition: 'STANDING', difficulty: 'BEGINNER' }),
      v('peso-muerto-rumano-smith', 'Peso muerto rumano en máquina Smith', 'Máquina Smith', 'SMITH_MACHINE', 'PLATE_LOADED', { machineType: 'SMITH', grip: 'PRONATED', bodyPosition: 'STANDING' }),
      v('peso-muerto-bloques', 'Peso muerto desde bloques', 'Barra olímpica y bloques', 'BARBELL', 'FREE_WEIGHT', { grip: 'MIXED', gripWidth: 'SHOULDER_WIDTH', bodyPosition: 'STANDING', difficulty: 'ADVANCED', oneRmSuitability: 'SUITABLE' }),
    ],
  },
  {
    key: 'extension-rodilla', primary: 'cuadriceps', secondary: [], movementType: 'ISOLATION', pattern: 'KNEE_EXTENSION', plane: 'SAGITTAL', difficulty: 'BEGINNER', oneRmSuitability: 'NOT_SUITABLE',
    description: 'Extensión de rodilla con carga controlada, habitualmente realizada en posición sentada.',
    instructions: 'Ajusta el eje de la máquina con la rodilla y controla tanto la extensión como el retorno.',
    variants: [
      v('maquina', 'Extensión de rodilla en máquina', 'Máquina de extensión selectorizada', 'MACHINE', 'WEIGHT_STACK', { machineType: 'SELECTORIZED', bodyPosition: 'SEATED' }),
      v('unilateral', 'Extensión unilateral de rodilla en máquina', 'Máquina de extensión selectorizada', 'MACHINE', 'WEIGHT_STACK', { machineType: 'SELECTORIZED', bodyPosition: 'SEATED', laterality: 'UNILATERAL' }),
      v('polea-tobillera', 'Extensión de rodilla de pie en polea', 'Polea baja y tobillera', 'CABLE', 'CABLE', { machineType: 'CABLE', bodyPosition: 'STANDING', laterality: 'UNILATERAL' }),
      v('banda', 'Extensión de rodilla con banda', 'Banda elástica anclada', 'RESISTANCE_BAND', 'ELASTIC', { bodyPosition: 'SEATED' }),
      v('terminal-banda', 'Extensión terminal de rodilla con banda', 'Banda elástica', 'RESISTANCE_BAND', 'ELASTIC', { bodyPosition: 'STANDING' }),
      v('sissy', 'Sentadilla sissy asistida', 'Soporte de sentadilla sissy', 'MACHINE', 'BODYWEIGHT', { machineType: 'OTHER', bodyPosition: 'STANDING', difficulty: 'ADVANCED' }),
    ],
  },
  {
    key: 'flexion-rodilla', primary: 'isquiotibiales', secondary: ['gemelos'], movementType: 'ISOLATION', pattern: 'KNEE_FLEXION', plane: 'SAGITTAL', difficulty: 'BEGINNER', oneRmSuitability: 'NOT_SUITABLE',
    description: 'Flexión de rodilla con resistencia para trabajar la musculatura posterior del muslo.',
    instructions: 'Alinea la rodilla con el eje y mantén la pelvis estable durante todo el recorrido.',
    variants: [
      v('nordico-asistido', 'Curl nórdico asistido con banda', 'Anclaje para tobillos y banda', 'RESISTANCE_BAND', 'ELASTIC', {bodyPosition:'KNEELING',difficulty:'INTERMEDIATE',instructions:'Fija los tobillos y utiliza la banda como asistencia. Desciende con caderas extendidas y controla la flexión de rodilla al regresar.'}),
      v('tumbado', 'Curl femoral tumbado en máquina', 'Máquina de curl femoral tumbado', 'MACHINE', 'WEIGHT_STACK', { machineType: 'SELECTORIZED', bodyPosition: 'PRONE' }),
      v('sentado', 'Curl femoral sentado en máquina', 'Máquina de curl femoral sentado', 'MACHINE', 'WEIGHT_STACK', { machineType: 'SELECTORIZED', bodyPosition: 'SEATED' }),
      v('unilateral', 'Curl femoral unilateral en máquina', 'Máquina de curl femoral', 'MACHINE', 'WEIGHT_STACK', { machineType: 'SELECTORIZED', bodyPosition: 'SEATED', laterality: 'UNILATERAL' }),
      v('de-pie', 'Curl femoral de pie en máquina', 'Máquina de curl femoral de pie', 'MACHINE', 'WEIGHT_STACK', { machineType: 'SELECTORIZED', bodyPosition: 'STANDING', laterality: 'UNILATERAL' }),
      v('polea', 'Curl femoral de pie en polea', 'Polea baja y tobillera', 'CABLE', 'CABLE', { machineType: 'CABLE', bodyPosition: 'STANDING', laterality: 'UNILATERAL' }),
      v('banda', 'Curl femoral con banda elástica', 'Banda elástica', 'RESISTANCE_BAND', 'ELASTIC', { bodyPosition: 'PRONE' }),
      v('nordico', 'Curl nórdico de isquiotibiales', 'Soporte para curl nórdico', 'BODYWEIGHT', 'BODYWEIGHT', { bodyPosition: 'KNEELING', difficulty: 'ADVANCED' }),
      v('deslizante', 'Curl femoral deslizante', 'Discos deslizantes o toallas', 'BODYWEIGHT', 'BODYWEIGHT', { bodyPosition: 'SUPINE', difficulty: 'INTERMEDIATE' }),
    ],
  },
  {
    key: 'unilateral-pierna', primary: 'cuadriceps', secondary: ['gluteos', 'isquiotibiales', 'aductores'], movementType: 'COMPOUND', pattern: 'LUNGE', plane: 'SAGITTAL', difficulty: 'INTERMEDIATE', oneRmSuitability: 'NOT_SUITABLE',
    description: 'Patrón unilateral de flexión de cadera y rodilla; la longitud del paso cambia la demanda relativa.',
    instructions: 'Mantén el pie delantero apoyado y controla la rodilla en la dirección de los dedos del pie.',
    variants: [
      v('zancada-estatica-mancuernas', 'Zancada estática con mancuernas', 'Mancuernas', 'DUMBBELL', 'FREE_WEIGHT', { grip: 'NEUTRAL', bodyPosition: 'STANDING', laterality: 'ALTERNATING' }),
      v('zancada-caminando', 'Zancada caminando con mancuernas', 'Mancuernas', 'DUMBBELL', 'FREE_WEIGHT', { grip: 'NEUTRAL', bodyPosition: 'STANDING', laterality: 'ALTERNATING' }),
      v('zancada-atras-barra', 'Zancada hacia atrás con barra', 'Barra olímpica y rack', 'BARBELL', 'FREE_WEIGHT', { grip: 'PRONATED', bodyPosition: 'STANDING', laterality: 'ALTERNATING', difficulty: 'ADVANCED' }),
      v('split-squat-smith', 'Sentadilla dividida en máquina Smith', 'Máquina Smith', 'SMITH_MACHINE', 'PLATE_LOADED', { machineType: 'SMITH', bodyPosition: 'STANDING', laterality: 'UNILATERAL' }),
      v('bulgara-mancuernas', 'Sentadilla búlgara con mancuernas', 'Mancuernas y banco', 'DUMBBELL', 'FREE_WEIGHT', { grip: 'NEUTRAL', bodyPosition: 'STANDING', laterality: 'UNILATERAL', difficulty: 'ADVANCED' }),
      v('step-up', 'Subida al cajón con mancuernas', 'Mancuernas y cajón estable', 'DUMBBELL', 'FREE_WEIGHT', { grip: 'NEUTRAL', bodyPosition: 'STANDING', laterality: 'ALTERNATING' }),
      v('pistol-asistida', 'Sentadilla pistol asistida', 'Soporte estable', 'BODYWEIGHT', 'BODYWEIGHT', { bodyPosition: 'STANDING', laterality: 'UNILATERAL', difficulty: 'ADVANCED' }),
      v('pistol', 'Sentadilla pistol', 'Peso corporal', 'BODYWEIGHT', 'BODYWEIGHT', { bodyPosition: 'STANDING', laterality: 'UNILATERAL', difficulty: 'ADVANCED' }),
      v('prensa-unilateral', 'Prensa de piernas unilateral', 'Máquina de prensa a 45 grados', 'MACHINE', 'PLATE_LOADED', { machineType: 'LEG_PRESS', bodyPosition: 'SEATED', laterality: 'UNILATERAL' }),
      v('zancada-banda', 'Zancada atrás con banda elástica', 'Banda elástica', 'RESISTANCE_BAND', 'ELASTIC', { bodyPosition: 'STANDING', laterality: 'ALTERNATING', difficulty: 'BEGINNER' }),
    ],
  },
  {
    key: 'prensa-piernas', primary: 'cuadriceps', secondary: ['gluteos', 'aductores'], movementType: 'COMPOUND', pattern: 'SQUAT', plane: 'SAGITTAL', difficulty: 'BEGINNER', oneRmSuitability: 'UNDETERMINED',
    description: 'Empuje de piernas con el tronco apoyado; la posición de los pies cambia el recorrido disponible.',
    instructions: 'No bloquees las rodillas al extender y conserva el apoyo lumbar en el respaldo.',
    variants: [
      v('45', 'Prensa de piernas a 45 grados', 'Prensa de piernas cargada con discos', 'MACHINE', 'PLATE_LOADED', { machineType: 'LEG_PRESS', bodyPosition: 'SEATED' }),
      v('horizontal', 'Prensa horizontal de piernas', 'Prensa horizontal selectorizada', 'MACHINE', 'WEIGHT_STACK', { machineType: 'LEG_PRESS', bodyPosition: 'SEATED' }),
      v('vertical', 'Prensa vertical de piernas', 'Prensa vertical cargada con discos', 'MACHINE', 'PLATE_LOADED', { machineType: 'LEG_PRESS', bodyPosition: 'SUPINE', difficulty: 'INTERMEDIATE' }),
      v('convergente', 'Prensa convergente de piernas', 'Prensa convergente', 'MACHINE', 'PLATE_LOADED', { machineType: 'CONVERGING', bodyPosition: 'SEATED' }),
      v('pies-altos', 'Prensa de piernas con pies altos', 'Prensa de piernas a 45 grados', 'MACHINE', 'PLATE_LOADED', { machineType: 'LEG_PRESS', bodyPosition: 'SEATED' }),
      v('pies-bajos', 'Prensa de piernas con pies bajos', 'Prensa de piernas a 45 grados', 'MACHINE', 'PLATE_LOADED', { machineType: 'LEG_PRESS', bodyPosition: 'SEATED' }),
    ],
  },
  {
    key: 'extension-cadera', primary: 'gluteos', secondary: ['isquiotibiales', 'erectores-espinales'], movementType: 'COMPOUND', pattern: 'HIP_EXTENSION', plane: 'SAGITTAL', difficulty: 'BEGINNER', oneRmSuitability: 'NOT_SUITABLE',
    description: 'Extensión de cadera con énfasis en glúteos; puede realizarse con el tronco apoyado o libre.',
    instructions: 'Extiende la cadera sin hiperextender la espalda y controla el retorno a la posición inicial.',
    variants: [
      v('hip-thrust-barra', 'Hip thrust con barra', 'Barra olímpica y banco', 'BARBELL', 'FREE_WEIGHT', { grip: 'NONE', bodyPosition: 'SUPINE', oneRmSuitability: 'SUITABLE' }),
      v('hip-thrust-smith', 'Hip thrust en máquina Smith', 'Máquina Smith y banco', 'SMITH_MACHINE', 'PLATE_LOADED', { machineType: 'SMITH', bodyPosition: 'SUPINE' }),
      v('hip-thrust-maquina', 'Hip thrust en máquina', 'Máquina de hip thrust', 'MACHINE', 'PLATE_LOADED', { machineType: 'LEVER', bodyPosition: 'SUPINE' }),
      v('puente-suelo', 'Puente de glúteos en el suelo', 'Peso corporal', 'BODYWEIGHT', 'BODYWEIGHT', { bodyPosition: 'SUPINE', difficulty: 'BEGINNER' }),
      v('puente-barra', 'Puente de glúteos con barra', 'Barra olímpica y colchoneta', 'BARBELL', 'FREE_WEIGHT', { bodyPosition: 'SUPINE' }),
      v('extension-banco', 'Extensión de cadera en banco romano', 'Banco romano', 'MACHINE', 'BODYWEIGHT', { machineType: 'OTHER', bodyPosition: 'PRONE' }),
      v('patada-polea', 'Patada de glúteo en polea', 'Polea baja y tobillera', 'CABLE', 'CABLE', { machineType: 'CABLE', bodyPosition: 'STANDING', laterality: 'UNILATERAL', movementType: 'ISOLATION' }),
      v('patada-maquina', 'Patada de glúteo en máquina', 'Máquina de extensión de cadera', 'MACHINE', 'WEIGHT_STACK', { machineType: 'SELECTORIZED', bodyPosition: 'STANDING', laterality: 'UNILATERAL', movementType: 'ISOLATION' }),
    ],
  },
  {
    key: 'cadera-abduccion-adduccion', primary: 'abductores', secondary: ['gluteos'], movementType: 'ISOLATION', pattern: 'HIP_ABDUCTION', plane: 'FRONTAL', difficulty: 'BEGINNER', oneRmSuitability: 'NOT_SUITABLE',
    description: 'Trabajo de abducción de cadera o de control lateral con resistencia estable.',
    instructions: 'Evita rotar el tronco y usa un rango cómodo; mantén la pelvis estable.',
    variants: [
      v('copenhague', 'Plancha de Copenhague con rodilla apoyada', 'Banco estable y colchoneta', 'BODYWEIGHT', 'ISOMETRIC', {primary:'aductores',secondary:['oblicuos'],bodyPosition:'SIDE_LYING',movementType:'ISOMETRIC',pattern:'HIP_ADDUCTION',laterality:'UNILATERAL',difficulty:'INTERMEDIATE',instructions:'Apoya la rodilla superior en el banco y el antebrazo en el suelo. Eleva la pelvis y mantén el tronco alineado.'}),
      v('abduccion-maquina', 'Abducción de cadera en máquina', 'Máquina de abducción selectorizada', 'MACHINE', 'WEIGHT_STACK', { machineType: 'SELECTORIZED', bodyPosition: 'SEATED' }),
      v('abduccion-polea', 'Abducción de cadera de pie en polea', 'Polea baja y tobillera', 'CABLE', 'CABLE', { machineType: 'CABLE', bodyPosition: 'STANDING', laterality: 'UNILATERAL' }),
      v('abduccion-banda', 'Abducción de cadera con banda', 'Banda elástica', 'RESISTANCE_BAND', 'ELASTIC', { bodyPosition: 'STANDING', laterality: 'UNILATERAL' }),
      v('caminata-lateral', 'Caminata lateral con banda', 'Banda elástica corta', 'RESISTANCE_BAND', 'ELASTIC', { bodyPosition: 'STANDING', laterality: 'ALTERNATING' }),
      v('clam-shell', 'Clamshell con banda', 'Banda elástica corta', 'RESISTANCE_BAND', 'ELASTIC', { bodyPosition: 'SIDE_LYING', laterality: 'UNILATERAL' }),
      v('adduccion-maquina', 'Aducción de cadera en máquina', 'Máquina de aducción selectorizada', 'MACHINE', 'WEIGHT_STACK', { machineType: 'SELECTORIZED', bodyPosition: 'SEATED', primary: 'aductores', secondary: ['gluteos'], pattern: 'HIP_ADDUCTION' }),
      v('adduccion-polea', 'Aducción de cadera de pie en polea', 'Polea baja y tobillera', 'CABLE', 'CABLE', { machineType: 'CABLE', bodyPosition: 'STANDING', laterality: 'UNILATERAL', primary: 'aductores', secondary: ['gluteos'], pattern: 'HIP_ADDUCTION' }),
      v('adduccion-banda', 'Aducción de cadera con banda', 'Banda elástica', 'RESISTANCE_BAND', 'ELASTIC', { bodyPosition: 'STANDING', laterality: 'UNILATERAL', primary: 'aductores', secondary: ['gluteos'], pattern: 'HIP_ADDUCTION' }),
      v('elevacion-pelvis-lateral', 'Elevación de pelvis en decúbito lateral', 'Peso corporal', 'BODYWEIGHT', 'BODYWEIGHT', { bodyPosition: 'SIDE_LYING', laterality: 'UNILATERAL' }),
    ],
  },
  {
    key: 'elevacion-talones', primary: 'gemelos', secondary: ['soleo'], movementType: 'ISOLATION', pattern: 'CALF_RAISE', plane: 'SAGITTAL', difficulty: 'BEGINNER', oneRmSuitability: 'NOT_SUITABLE',
    description: 'Flexión plantar para trabajar la pantorrilla; la rodilla extendida o flexionada modifica el énfasis.',
    instructions: 'Usa un recorrido controlado y pausa brevemente arriba sin rebotar en la parte inferior.',
    variants: [
      v('de-pie-maquina', 'Elevación de talones de pie en máquina', 'Máquina de gemelos de pie', 'MACHINE', 'WEIGHT_STACK', { machineType: 'SELECTORIZED', bodyPosition: 'STANDING' }),
      v('de-pie-smith', 'Elevación de talones de pie en máquina Smith', 'Máquina Smith y plataforma', 'SMITH_MACHINE', 'PLATE_LOADED', { machineType: 'SMITH', bodyPosition: 'STANDING' }),
      v('prensa', 'Elevación de talones en prensa de piernas', 'Prensa de piernas', 'MACHINE', 'PLATE_LOADED', { machineType: 'LEG_PRESS', bodyPosition: 'SEATED' }),
      v('unilateral', 'Elevación unilateral de talón con mancuerna', 'Mancuerna y soporte', 'DUMBBELL', 'FREE_WEIGHT', { bodyPosition: 'STANDING', laterality: 'UNILATERAL' }),
      v('sentado-maquina', 'Elevación de talones sentado en máquina', 'Máquina de gemelos sentado', 'MACHINE', 'WEIGHT_STACK', { machineType: 'SELECTORIZED', bodyPosition: 'SEATED', primary: 'soleo', secondary: ['gemelos'] }),
      v('sentado-mancuerna', 'Elevación de talones sentado con mancuerna', 'Mancuernas y banco', 'DUMBBELL', 'FREE_WEIGHT', { bodyPosition: 'SEATED', primary: 'soleo', secondary: ['gemelos'] }),
      v('donkey', 'Elevación de talones tipo donkey', 'Máquina donkey o soporte', 'MACHINE', 'PLATE_LOADED', { machineType: 'LEVER', bodyPosition: 'STANDING' }),
      v('peso-corporal', 'Elevación de talones con peso corporal', 'Escalón estable', 'BODYWEIGHT', 'BODYWEIGHT', { bodyPosition: 'STANDING' }),
    ],
  },
  {
    key: 'curl-biceps', primary: 'biceps', secondary: ['antebrazos'], movementType: 'ISOLATION', pattern: 'ELBOW_FLEXION', plane: 'SAGITTAL', difficulty: 'BEGINNER', oneRmSuitability: 'NOT_SUITABLE',
    description: 'Flexión de codo con el brazo estable; el agarre modifica la participación de los flexores del antebrazo.',
    instructions: 'Mantén los codos controlados junto al cuerpo o en el soporte y evita balancear el tronco.',
    variants: [
      v('bayesiano', 'Curl bayesiano unilateral en polea', 'Polea baja y maneral', 'CABLE', 'CABLE', {machineType:'CABLE',bodyPosition:'STANDING',grip:'SUPINATED',laterality:'UNILATERAL',instructions:'Sitúate delante de la polea con el brazo ligeramente detrás del torso. Flexiona el codo sin adelantar el hombro.'}),
      v('spider', 'Curl araña con mancuernas', 'Mancuernas y banco inclinado', 'DUMBBELL', 'FREE_WEIGHT', {bodyPosition:'PRONE',grip:'SUPINATED'}),
      v('zottman', 'Curl Zottman con mancuernas', 'Mancuernas', 'DUMBBELL', 'FREE_WEIGHT', {bodyPosition:'STANDING',grip:'VARIABLE',instructions:'Eleva con las palmas hacia arriba, gira con control al llegar arriba y desciende con las palmas hacia abajo.'}),
      v('barra-recta', 'Curl de bíceps con barra recta', 'Barra olímpica', 'BARBELL', 'FREE_WEIGHT', { grip: 'SUPINATED', gripWidth: 'SHOULDER_WIDTH', bodyPosition: 'STANDING' }),
      v('barra-ez', 'Curl de bíceps con barra EZ', 'Barra EZ', 'EZ_BAR', 'FREE_WEIGHT', { grip: 'SUPINATED', gripWidth: 'SHOULDER_WIDTH', bodyPosition: 'STANDING' }),
      v('ez-agarre-ancho', 'Curl con barra EZ y agarre ancho', 'Barra EZ', 'EZ_BAR', 'FREE_WEIGHT', { grip: 'SUPINATED', gripWidth: 'WIDE', bodyPosition: 'STANDING' }),
      v('mancuernas-alternado', 'Curl alterno con mancuernas', 'Mancuernas', 'DUMBBELL', 'FREE_WEIGHT', { grip: 'SUPINATED', bodyPosition: 'STANDING', laterality: 'ALTERNATING' }),
      v('martillo', 'Curl martillo con mancuernas', 'Mancuernas', 'DUMBBELL', 'FREE_WEIGHT', { grip: 'NEUTRAL', bodyPosition: 'STANDING' }),
      v('inclinado', 'Curl inclinado con mancuernas', 'Mancuernas y banco inclinado', 'DUMBBELL', 'FREE_WEIGHT', { grip: 'SUPINATED', bodyPosition: 'SUPINE' }),
      v('concentrado', 'Curl concentrado con mancuerna', 'Mancuerna y banco', 'DUMBBELL', 'FREE_WEIGHT', { grip: 'SUPINATED', bodyPosition: 'SEATED', laterality: 'UNILATERAL' }),
      v('predicador-ez', 'Curl predicador con barra EZ', 'Barra EZ y banco predicador', 'EZ_BAR', 'FREE_WEIGHT', { grip: 'SUPINATED', bodyPosition: 'SEATED' }),
      v('predicador-maquina', 'Curl predicador en máquina', 'Máquina de curl predicador', 'MACHINE', 'WEIGHT_STACK', { machineType: 'SELECTORIZED', bodyPosition: 'SEATED' }),
      v('polea-barra', 'Curl de bíceps en polea con barra recta', 'Polea baja y barra recta', 'CABLE', 'CABLE', { machineType: 'CABLE', grip: 'SUPINATED', bodyPosition: 'STANDING' }),
      v('polea-cuerda', 'Curl de bíceps en polea con cuerda', 'Polea baja y cuerda', 'CABLE', 'CABLE', { machineType: 'CABLE', grip: 'NEUTRAL', bodyPosition: 'STANDING' }),
      v('polea-unilateral', 'Curl unilateral en polea baja', 'Polea baja y maneral individual', 'CABLE', 'CABLE', { machineType: 'CABLE', grip: 'SUPINATED', bodyPosition: 'STANDING', laterality: 'UNILATERAL' }),
    ],
  },
  {
    key: 'extension-triceps', primary: 'triceps', secondary: ['antebrazos'], movementType: 'ISOLATION', pattern: 'ELBOW_EXTENSION', plane: 'SAGITTAL', difficulty: 'BEGINNER', oneRmSuitability: 'NOT_SUITABLE',
    description: 'Extensión del codo para trabajar el tríceps; la posición del brazo modifica el recorrido y el énfasis.',
    instructions: 'Mantén el brazo estable y termina la extensión sin mover el hombro de forma brusca.',
    variants: [
      v('katana', 'Extensión de tríceps katana en poleas', 'Dos poleas altas y manerales', 'CABLE', 'CABLE', {machineType:'CABLE',bodyPosition:'STANDING',grip:'NEUTRAL',instructions:'Cruza los cables detrás de la cabeza. Extiende los codos sin desplazar los brazos y vuelve con control.'}),
      v('tate', 'Press Tate con mancuernas', 'Mancuernas y banco plano', 'DUMBBELL', 'FREE_WEIGHT', {bodyPosition:'SUPINE',grip:'PRONATED',instructions:'Con los codos abiertos, acerca las mancuernas al pecho flexionando los codos y extiéndelos con un recorrido cómodo.'}),
      v('pushdown-barra', 'Extensión de tríceps en polea con barra', 'Polea alta y barra recta', 'CABLE', 'CABLE', { machineType: 'CABLE', grip: 'PRONATED', bodyPosition: 'STANDING' }),
      v('pushdown-cuerda', 'Extensión de tríceps en polea con cuerda', 'Polea alta y cuerda', 'CABLE', 'CABLE', { machineType: 'CABLE', grip: 'NEUTRAL', bodyPosition: 'STANDING' }),
      v('pushdown-inverso', 'Extensión de tríceps con agarre supino', 'Polea alta y barra recta', 'CABLE', 'CABLE', { machineType: 'CABLE', grip: 'SUPINATED', bodyPosition: 'STANDING' }),
      v('unilateral', 'Extensión unilateral de tríceps en polea', 'Polea alta y maneral', 'CABLE', 'CABLE', { machineType: 'CABLE', grip: 'NEUTRAL', bodyPosition: 'STANDING', laterality: 'UNILATERAL' }),
      v('overhead-cuerda', 'Extensión de tríceps sobre la cabeza con cuerda', 'Polea baja y cuerda', 'CABLE', 'CABLE', { machineType: 'CABLE', grip: 'NEUTRAL', bodyPosition: 'STANDING' }),
      v('frances-ez', 'Extensión francesa tumbada con barra EZ', 'Barra EZ y banco plano', 'EZ_BAR', 'FREE_WEIGHT', { grip: 'PRONATED', gripWidth: 'NARROW', bodyPosition: 'SUPINE' }),
      v('frances-mancuernas', 'Extensión francesa tumbada con mancuernas', 'Mancuernas y banco plano', 'DUMBBELL', 'FREE_WEIGHT', { grip: 'NEUTRAL', bodyPosition: 'SUPINE' }),
      v('sobre-cabeza-mancuerna', 'Extensión de tríceps sobre la cabeza con mancuerna', 'Mancuerna', 'DUMBBELL', 'FREE_WEIGHT', { grip: 'NEUTRAL', bodyPosition: 'SEATED' }),
      v('maquina', 'Extensión de tríceps en máquina', 'Máquina de extensión de tríceps', 'MACHINE', 'WEIGHT_STACK', { machineType: 'SELECTORIZED', bodyPosition: 'SEATED' }),
      v('banda', 'Extensión de tríceps con banda', 'Banda elástica anclada', 'RESISTANCE_BAND', 'ELASTIC', { grip: 'NEUTRAL', bodyPosition: 'STANDING' }),
      v('kickback', 'Patada de tríceps con mancuerna', 'Mancuerna y banco', 'DUMBBELL', 'FREE_WEIGHT', { grip: 'NEUTRAL', bodyPosition: 'STANDING', laterality: 'UNILATERAL' }),
    ],
  },
  {
    key: 'antebrazo', primary: 'antebrazos', secondary: ['biceps'], movementType: 'ISOLATION', pattern: 'OTHER', plane: 'SAGITTAL', difficulty: 'BEGINNER', oneRmSuitability: 'NOT_SUITABLE',
    description: 'Trabajo de flexión, extensión o rotación de muñeca y antebrazo con cargas ligeras y controladas.',
    instructions: 'Mantén el antebrazo apoyado cuando corresponda y usa un rango tolerable de muñeca.',
    variants: [
      v('pronacion-mancuerna', 'Pronación de antebrazo con mancuerna', 'Mancuerna ligera y apoyo', 'DUMBBELL', 'FREE_WEIGHT', {bodyPosition:'SEATED',grip:'VARIABLE',laterality:'UNILATERAL',secondary:[],instructions:'Apoya el antebrazo y gira lentamente la palma hacia abajo. No desplaces el codo ni utilices impulso.'}),
      v('supinacion-mancuerna', 'Supinación de antebrazo con mancuerna', 'Mancuerna ligera y apoyo', 'DUMBBELL', 'FREE_WEIGHT', {bodyPosition:'SEATED',grip:'VARIABLE',laterality:'UNILATERAL',secondary:[],instructions:'Apoya el antebrazo y gira lentamente la palma hacia arriba. Mantén la muñeca neutra durante el movimiento.'}),
      v('curl-muneca-barra', 'Flexión de muñeca con barra', 'Barra recta', 'BARBELL', 'FREE_WEIGHT', { grip: 'SUPINATED', bodyPosition: 'SEATED' }),
      v('curl-muneca-inverso', 'Extensión de muñeca con barra', 'Barra recta', 'BARBELL', 'FREE_WEIGHT', { grip: 'PRONATED', bodyPosition: 'SEATED' }),
      v('mancuerna-unilateral', 'Flexión de muñeca unilateral con mancuerna', 'Mancuerna y banco', 'DUMBBELL', 'FREE_WEIGHT', { grip: 'SUPINATED', bodyPosition: 'SEATED', laterality: 'UNILATERAL' }),
      v('curl-inverso-ez', 'Curl inverso con barra EZ', 'Barra EZ', 'EZ_BAR', 'FREE_WEIGHT', { grip: 'PRONATED', bodyPosition: 'STANDING' }),
      v('curl-martillo-cuerda', 'Curl martillo con cuerda en polea', 'Polea baja y cuerda', 'CABLE', 'CABLE', { machineType: 'CABLE', grip: 'NEUTRAL', bodyPosition: 'STANDING' }),
      v('farmer-mancuernas', 'Paseo del granjero con mancuernas', 'Mancuernas', 'DUMBBELL', 'FREE_WEIGHT', { grip: 'NEUTRAL', bodyPosition: 'STANDING', movementType: 'CARRY', pattern: 'CARRY' }),
      v('farmer-kettlebell', 'Paseo del granjero con kettlebells', 'Kettlebells', 'KETTLEBELL', 'FREE_WEIGHT', { grip: 'NEUTRAL', bodyPosition: 'STANDING', movementType: 'CARRY', pattern: 'CARRY' }),
      v('pinza-discos', 'Agarre de pinza con discos', 'Discos de peso', 'OTHER', 'FREE_WEIGHT', { grip: 'NONE', bodyPosition: 'STANDING', movementType: 'ISOMETRIC' }),
    ],
  },
  {
    key: 'flexion-tronco', primary: 'abdominales', secondary: ['oblicuos'], movementType: 'ISOLATION', pattern: 'TRUNK_FLEXION', plane: 'SAGITTAL', difficulty: 'BEGINNER', oneRmSuitability: 'NOT_SUITABLE',
    description: 'Flexión del tronco o de la pelvis con resistencia ajustable y rango controlado.',
    instructions: 'Evita tirar del cuello y concentra el movimiento en el tronco, sin rebotes.',
    variants: [
      v('crunch-suelo', 'Crunch abdominal en el suelo', 'Peso corporal y colchoneta', 'BODYWEIGHT', 'BODYWEIGHT', { bodyPosition: 'SUPINE' }),
      v('crunch-polea', 'Crunch abdominal en polea alta', 'Polea alta y cuerda', 'CABLE', 'CABLE', { machineType: 'CABLE', grip: 'NEUTRAL', bodyPosition: 'KNEELING' }),
      v('crunch-maquina', 'Crunch abdominal en máquina', 'Máquina abdominal selectorizada', 'MACHINE', 'WEIGHT_STACK', { machineType: 'SELECTORIZED', bodyPosition: 'SEATED' }),
      v('elevacion-rodillas-colgado', 'Elevación de rodillas colgado', 'Barra fija', 'BODYWEIGHT', 'BODYWEIGHT', { bodyPosition: 'HANGING', difficulty: 'INTERMEDIATE' }),
      v('elevacion-piernas-colgado', 'Elevación de piernas colgado', 'Barra fija', 'BODYWEIGHT', 'BODYWEIGHT', { bodyPosition: 'HANGING', difficulty: 'ADVANCED' }),
      v('reverse-crunch', 'Crunch inverso en banco', 'Banco plano', 'BODYWEIGHT', 'BODYWEIGHT', { bodyPosition: 'SUPINE' }),
      v('ab-wheel', 'Despliegue abdominal con rueda', 'Rueda abdominal', 'OTHER', 'BODYWEIGHT', { bodyPosition: 'KNEELING', difficulty: 'INTERMEDIATE' }),
      v('sit-up', 'Abdominal completo en banco declinado', 'Banco declinado', 'OTHER', 'BODYWEIGHT', { bodyPosition: 'SUPINE', difficulty: 'INTERMEDIATE' }),
      v('balon-medicinal', 'Crunch con balón medicinal', 'Balón medicinal y colchoneta', 'MEDICINE_BALL', 'MEDICINE_BALL', { bodyPosition: 'SUPINE' }),
    ],
  },
  {
    key: 'estabilidad-rotacional', primary: 'oblicuos', secondary: ['abdominales', 'gluteos'], movementType: 'ISOMETRIC', pattern: 'ANTI_ROTATION', plane: 'TRANSVERSE', difficulty: 'BEGINNER', oneRmSuitability: 'NOT_SUITABLE',
    description: 'Trabajo de control del tronco frente a fuerzas de rotación o inclinación lateral.',
    instructions: 'Mantén pelvis y caja torácica alineadas. Respira con normalidad y evita compensar con la zona lumbar.',
    variants: [
      v('pallof-rodillas', 'Press Pallof de rodillas en polea', 'Polea ajustable y maneral', 'CABLE', 'ISOMETRIC', {machineType:'CABLE',bodyPosition:'KNEELING',laterality:'UNILATERAL'}),
      v('pallof-polea', 'Press Pallof en polea', 'Polea ajustable y maneral', 'CABLE', 'CABLE', { machineType: 'CABLE', grip: 'NEUTRAL', bodyPosition: 'STANDING' }),
      v('pallof-banda', 'Press Pallof con banda elástica', 'Banda elástica anclada', 'RESISTANCE_BAND', 'ELASTIC', { grip: 'NEUTRAL', bodyPosition: 'STANDING' }),
      v('plancha-frontal', 'Plancha frontal', 'Peso corporal y colchoneta', 'BODYWEIGHT', 'ISOMETRIC', { bodyPosition: 'PRONE', movementType: 'ISOMETRIC' }),
      v('plancha-lateral', 'Plancha lateral', 'Peso corporal y colchoneta', 'BODYWEIGHT', 'ISOMETRIC', { bodyPosition: 'SIDE_LYING', laterality: 'UNILATERAL', movementType: 'ISOMETRIC', pattern: 'ROTATION' }),
      v('woodchop-alto-bajo', 'Rotación diagonal de polea de arriba hacia abajo', 'Polea alta y maneral', 'CABLE', 'CABLE', { machineType: 'CABLE', grip: 'NEUTRAL', bodyPosition: 'STANDING', movementType: 'COMPOUND', pattern: 'ROTATION' }),
      v('woodchop-bajo-alto', 'Rotación diagonal de polea de abajo hacia arriba', 'Polea baja y maneral', 'CABLE', 'CABLE', { machineType: 'CABLE', grip: 'NEUTRAL', bodyPosition: 'STANDING', movementType: 'COMPOUND', pattern: 'ROTATION' }),
      v('giro-medicinal', 'Giro de tronco sentado con balón medicinal', 'Balón medicinal', 'MEDICINE_BALL', 'MEDICINE_BALL', { bodyPosition: 'SEATED', movementType: 'COMPOUND', pattern: 'ROTATION' }),
      v('suitcase-carry', 'Paseo unilateral tipo maleta', 'Mancuerna o kettlebell', 'DUMBBELL', 'FREE_WEIGHT', { grip: 'NEUTRAL', bodyPosition: 'STANDING', laterality: 'UNILATERAL', movementType: 'CARRY', pattern: 'CARRY' }),
      v('dead-bug', 'Dead bug', 'Peso corporal y colchoneta', 'BODYWEIGHT', 'ISOMETRIC', { bodyPosition: 'SUPINE', laterality: 'ALTERNATING', movementType: 'ISOMETRIC' }),
      v('bird-dog', 'Bird dog', 'Peso corporal y colchoneta', 'BODYWEIGHT', 'ISOMETRIC', { bodyPosition: 'QUADRUPED', laterality: 'ALTERNATING', movementType: 'ISOMETRIC' }),
    ],
  },
  {
    key: 'potencia-olimpica', primary: 'gluteos', secondary: ['cuadriceps', 'trapecio', 'espalda-alta'], movementType: 'OLYMPIC', pattern: 'OLYMPIC_LIFT', plane: 'SAGITTAL', difficulty: 'ADVANCED', oneRmSuitability: 'UNDETERMINED',
    description: 'Variantes técnicas de levantamientos de potencia que requieren progresión y supervisión adecuadas.',
    instructions: 'Practica primero con cargas ligeras y prioriza la técnica. Detén la serie si se deteriora la trayectoria o la recepción.',
    variants: [
      v('hang-power-clean', 'Cargada de potencia desde suspensión', 'Barra olímpica y discos', 'BARBELL', 'FREE_WEIGHT', { grip: 'HOOK', bodyPosition: 'STANDING' }),
      v('power-clean', 'Cargada de potencia desde el suelo', 'Barra olímpica y discos', 'BARBELL', 'FREE_WEIGHT', { grip: 'HOOK', bodyPosition: 'STANDING' }),
      v('hang-clean', 'Cargada desde suspensión', 'Barra olímpica y discos', 'BARBELL', 'FREE_WEIGHT', { grip: 'HOOK', bodyPosition: 'STANDING' }),
      v('clean-pull', 'Tirón de cargada', 'Barra olímpica y discos', 'BARBELL', 'FREE_WEIGHT', { grip: 'HOOK', bodyPosition: 'STANDING' }),
      v('snatch-pull', 'Tirón de arrancada', 'Barra olímpica y discos', 'BARBELL', 'FREE_WEIGHT', { grip: 'HOOK', gripWidth: 'WIDE', bodyPosition: 'STANDING' }),
      v('power-snatch', 'Arrancada de potencia', 'Barra olímpica y discos', 'BARBELL', 'FREE_WEIGHT', { grip: 'HOOK', gripWidth: 'WIDE', bodyPosition: 'STANDING' }),
      v('hang-power-snatch', 'Arrancada de potencia desde suspensión', 'Barra olímpica y discos', 'BARBELL', 'FREE_WEIGHT', { grip: 'HOOK', gripWidth: 'WIDE', bodyPosition: 'STANDING' }),
      v('push-press', 'Push press con barra', 'Barra olímpica', 'BARBELL', 'FREE_WEIGHT', { grip: 'PRONATED', gripWidth: 'SHOULDER_WIDTH', bodyPosition: 'STANDING' }),
      v('push-press-mancuernas', 'Push press con mancuernas', 'Mancuernas', 'DUMBBELL', 'FREE_WEIGHT', { grip: 'NEUTRAL', bodyPosition: 'STANDING' }),
      v('high-pull', 'Tirón alto con barra', 'Barra olímpica', 'BARBELL', 'FREE_WEIGHT', { grip: 'PRONATED', gripWidth: 'WIDE', bodyPosition: 'STANDING' }),
      v('kettlebell-clean', 'Cargada con kettlebell', 'Kettlebell', 'KETTLEBELL', 'FREE_WEIGHT', { grip: 'NEUTRAL', bodyPosition: 'STANDING' }),
      v('kettlebell-snatch', 'Arrancada con kettlebell', 'Kettlebell', 'KETTLEBELL', 'FREE_WEIGHT', { grip: 'NEUTRAL', bodyPosition: 'STANDING' }),
    ],
  },
  {
    key: 'potencia-salto', primary: 'cuadriceps', secondary: ['gluteos', 'gemelos'], movementType: 'PLYOMETRIC', pattern: 'JUMP', plane: 'SAGITTAL', difficulty: 'INTERMEDIATE', oneRmSuitability: 'NOT_SUITABLE',
    description: 'Ejercicios explosivos de salto; deben realizarse con una superficie despejada y volumen moderado.',
    instructions: 'Aterriza con control, absorbe el impacto y permite recuperación suficiente entre esfuerzos de calidad.',
    variants: [
      v('salto-cajon', 'Salto al cajón', 'Cajón pliométrico', 'OTHER', 'BODYWEIGHT', { bodyPosition: 'STANDING' }),
      v('salto-vertical', 'Salto vertical desde posición estática', 'Peso corporal', 'BODYWEIGHT', 'BODYWEIGHT', { bodyPosition: 'STANDING' }),
      v('salto-longitud', 'Salto horizontal desde posición estática', 'Peso corporal', 'BODYWEIGHT', 'BODYWEIGHT', { bodyPosition: 'STANDING', plane: 'SAGITTAL' }),
      v('salto-lateral', 'Salto lateral sobre línea', 'Peso corporal', 'BODYWEIGHT', 'BODYWEIGHT', { bodyPosition: 'STANDING', laterality: 'ALTERNATING', plane: 'FRONTAL' }),
      v('salto-sentadilla', 'Salto en sentadilla', 'Peso corporal', 'BODYWEIGHT', 'BODYWEIGHT', { bodyPosition: 'STANDING' }),
      v('salto-kettlebell', 'Salto con kettlebell ligera', 'Kettlebell', 'KETTLEBELL', 'FREE_WEIGHT', { bodyPosition: 'STANDING', difficulty: 'ADVANCED' }),
      v('lanzamiento-medicinal', 'Lanzamiento frontal de balón medicinal', 'Balón medicinal', 'MEDICINE_BALL', 'MEDICINE_BALL', { bodyPosition: 'STANDING' }),
      v('lanzamiento-rotacional', 'Lanzamiento rotacional de balón medicinal', 'Balón medicinal y pared', 'MEDICINE_BALL', 'MEDICINE_BALL', { bodyPosition: 'STANDING', laterality: 'ALTERNATING', plane: 'TRANSVERSE' }),
    ],
  },
  {
    key: 'extension-tronco', primary: 'erectores-espinales', secondary: ['gluteos', 'isquiotibiales'], movementType: 'COMPOUND', pattern: 'TRUNK_EXTENSION', plane: 'SAGITTAL', difficulty: 'BEGINNER', oneRmSuitability: 'NOT_SUITABLE',
    description: 'Extensión del tronco o control de la cadena posterior con el rango ajustado a la movilidad.',
    instructions: 'Mantén el movimiento controlado y evita hiperextender la espalda al final del recorrido.',
    variants: [
      v('extension-banco-45', 'Extensión de espalda en banco a 45 grados', 'Banco romano a 45 grados', 'MACHINE', 'BODYWEIGHT', { machineType: 'OTHER', bodyPosition: 'PRONE' }),
      v('extension-banco-horizontal', 'Extensión de espalda en banco horizontal', 'Banco de extensiones horizontal', 'MACHINE', 'BODYWEIGHT', { machineType: 'OTHER', bodyPosition: 'PRONE' }),
      v('extension-lastra', 'Extensión de espalda con disco', 'Banco romano y disco', 'OTHER', 'FREE_WEIGHT', { machineType: 'OTHER', bodyPosition: 'PRONE', difficulty: 'INTERMEDIATE' }),
      v('bird-dog', 'Bird dog con pausa', 'Peso corporal y colchoneta', 'BODYWEIGHT', 'ISOMETRIC', { bodyPosition: 'QUADRUPED', laterality: 'ALTERNATING', movementType: 'ISOMETRIC' }),
      v('superman', 'Extensión alterna en el suelo', 'Peso corporal y colchoneta', 'BODYWEIGHT', 'BODYWEIGHT', { bodyPosition: 'PRONE', laterality: 'ALTERNATING' }),
      v('good-morning-banda', 'Bisagra de cadera con banda elástica', 'Banda elástica', 'RESISTANCE_BAND', 'ELASTIC', { bodyPosition: 'STANDING', movementType: 'COMPOUND', pattern: 'HIP_HINGE' }),
    ],
  },
];

function buildExercise(family: Family, variant: Variant): ExerciseSeed {
  const movementType = variant.movementType ?? family.movementType;
  const movementPattern = variant.pattern ?? family.pattern;
  const plane = variant.plane ?? family.plane;
  return {
    catalogKey: `${family.key}-${variant.key}`,
    name: variant.name,
    primaryMuscleGroupKey: variant.primary ?? family.primary,
    secondaryMuscleGroupKeys: variant.secondary ?? family.secondary,
    equipment: variant.equipment,
    equipmentType: variant.equipmentType,
    machineType: variant.machineType ?? null,
    resistanceType: variant.resistanceType,
    movementType,
    movementPattern,
    grip: variant.grip ?? null,
    gripWidth: variant.gripWidth ?? null,
    bodyPosition: variant.bodyPosition ?? null,
    laterality: variant.laterality ?? 'BILATERAL',
    movementPlane: plane,
    difficulty: variant.difficulty ?? family.difficulty,
    oneRmSuitability: variant.oneRmSuitability ?? family.oneRmSuitability,
    description: variant.description ?? `${variant.name}. ${family.description}`,
    instructions: variant.instructions ?? family.instructions,
  };
}

export const exercises: ExerciseSeed[] = families.flatMap((family) =>
  family.variants.map((variant) => buildExercise(family, variant)),
);
