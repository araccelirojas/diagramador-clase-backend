-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "EstadoInvitacion" AS ENUM ('PENDIENTE', 'ACEPTADA', 'RECHAZADA');

-- CreateTable
CREATE TABLE "usuarios" (
    "idUsuario" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "correo" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "fechaRegistro" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estado" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("idUsuario")
);

-- CreateTable
CREATE TABLE "proyectos" (
    "idProyecto" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "contenido" JSONB NOT NULL DEFAULT '{}',
    "fechaCreacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idUsuario" UUID NOT NULL,

    CONSTRAINT "proyectos_pkey" PRIMARY KEY ("idProyecto")
);

-- CreateTable
CREATE TABLE "invitaciones" (
    "idInvitacion" UUID NOT NULL,
    "estado" "EstadoInvitacion" NOT NULL DEFAULT 'PENDIENTE',
    "fechaInvitacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idUsuario" UUID NOT NULL,
    "idProyecto" UUID NOT NULL,

    CONSTRAINT "invitaciones_pkey" PRIMARY KEY ("idInvitacion")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_correo_key" ON "usuarios"("correo");

-- CreateIndex
CREATE INDEX "proyectos_idUsuario_idx" ON "proyectos"("idUsuario");

-- CreateIndex
CREATE INDEX "invitaciones_idProyecto_idx" ON "invitaciones"("idProyecto");

-- CreateIndex
CREATE UNIQUE INDEX "invitaciones_idUsuario_idProyecto_key" ON "invitaciones"("idUsuario", "idProyecto");

-- AddForeignKey
ALTER TABLE "proyectos" ADD CONSTRAINT "proyectos_idUsuario_fkey" FOREIGN KEY ("idUsuario") REFERENCES "usuarios"("idUsuario") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitaciones" ADD CONSTRAINT "invitaciones_idUsuario_fkey" FOREIGN KEY ("idUsuario") REFERENCES "usuarios"("idUsuario") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitaciones" ADD CONSTRAINT "invitaciones_idProyecto_fkey" FOREIGN KEY ("idProyecto") REFERENCES "proyectos"("idProyecto") ON DELETE CASCADE ON UPDATE CASCADE;
