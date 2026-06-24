
import React, { useRef, useState, Suspense } from 'react';
import { Canvas, useFrame, useLoader } from '@react-three/fiber';
import {
    PerspectiveCamera,
    MeshTransmissionMaterial,
    Float,
    Environment,
    ContactShadows,
    OrbitControls
} from '@react-three/drei';
import * as THREE from 'three';

// Logo component inside the cube
const EmpresaLogoInside = ({ isHovered }: { isHovered: boolean }) => {
    const texture = useLoader(THREE.TextureLoader, "/Logo-Empresa.png");
    const meshRef = useRef<THREE.Mesh>(null!);

    useFrame((state) => {
        const time = state.clock.getElapsedTime();
        meshRef.current.position.y = Math.sin(time * 0.8) * 0.08;
        meshRef.current.rotation.y = Math.sin(time * 0.4) * 0.12;
    });

    return (
        <group>
            <mesh ref={meshRef} scale={[1.4, 0.5, 1]}>
                <planeGeometry />
                <meshBasicMaterial
                    map={texture}
                    transparent={true}
                    side={THREE.DoubleSide}
                    toneMapped={false}
                />
            </mesh>
            {/* Intense Red Glow that works on lighter backgrounds */}
            <pointLight
                position={[0, 0, 0.2]}
                intensity={isHovered ? 80 : 30}
                distance={5}
                color="#1E73C8"
            />
        </group>
    );
};

const FrostedCube = () => {
    const meshRef = useRef<THREE.Mesh>(null!);
    const [hovered, setHovered] = useState(false);
    const speedRef = useRef(0.15); // Slower base speed

    useFrame((state, delta) => {
        const targetSpeed = hovered ? 0.6 : 0.15;
        speedRef.current = THREE.MathUtils.lerp(speedRef.current, targetSpeed, 0.05);
        meshRef.current.rotation.x += delta * speedRef.current * 0.5;
        meshRef.current.rotation.y += delta * speedRef.current;
    });

    return (
        <Float rotationIntensity={0.1} floatIntensity={0.2} speed={1.0}>
            <mesh
                ref={meshRef}
                onPointerOver={() => setHovered(true)}
                onPointerOut={() => setHovered(false)}
            >
                <boxGeometry args={[2.2, 2.2, 2.2]} />
                <MeshTransmissionMaterial
                    samples={16}
                    thickness={0.1}
                    chromaticAberration={0.02}
                    anisotropy={0.1}
                    distortion={0.0}
                    distortionScale={0.1}
                    temporalDistortion={0.0}
                    ior={1.0}
                    transmission={1.0}
                    roughness={0.01}
                    color="#ffffff"
                    transparent={true}
                    opacity={0.5}
                />
                <Suspense fallback={null}>
                    <EmpresaLogoInside isHovered={hovered} />
                </Suspense>
            </mesh>
        </Float>
    );
};

const Scene = () => {
    return (
        <>
            <PerspectiveCamera makeDefault position={[0, 0, 6]} fov={35} />
            <ambientLight intensity={1.0} />
            <spotLight position={[10, 10, 10]} angle={0.2} penumbra={1} intensity={2.0} />
            <pointLight position={[-10, 5, 5]} intensity={1.0} color="#fff" />

            <FrostedCube />

            <Environment preset="city" />
            <ContactShadows
                position={[1.5, -2.8, 0]}
                opacity={0.2}
                scale={10}
                blur={2.5}
                far={5}
            />
            <OrbitControls
                enableZoom={false}
                enablePan={false}
                minPolarAngle={Math.PI / 2.5}
                maxPolarAngle={Math.PI / 1.5}
            />
        </>
    );
};

const Home3D: React.FC = () => {
    return (
        <div className="w-full h-full flex items-center justify-center">
            <Canvas dpr={[1, 2]} gl={{ antialias: true, alpha: true }}>
                <Suspense fallback={null}>
                    <Scene />
                </Suspense>
            </Canvas>
        </div>
    );
};

export default Home3D;
