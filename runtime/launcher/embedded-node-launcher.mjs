const elfBaseAddress = 0x400000n;
const elfHeaderSize = 64;
const programHeaderSize = 56;
const programHeaderCount = 2;
const codeOffset = elfHeaderSize + programHeaderSize * programHeaderCount;
const payloadOffset = 4096;

function uint16(buffer, offset, value) {
  buffer.writeUInt16LE(value, offset);
}

function uint32(buffer, offset, value) {
  buffer.writeUInt32LE(value, offset);
}

function uint64(buffer, offset, value) {
  buffer.writeBigUInt64LE(BigInt(value), offset);
}

function elfHeaders(fileSize) {
  const headers = Buffer.alloc(codeOffset);
  headers.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0], 0);
  uint16(headers, 16, 2); // ET_EXEC
  uint16(headers, 18, 62); // EM_X86_64
  uint32(headers, 20, 1);
  uint64(headers, 24, elfBaseAddress + BigInt(codeOffset));
  uint64(headers, 32, elfHeaderSize);
  uint16(headers, 52, elfHeaderSize);
  uint16(headers, 54, programHeaderSize);
  uint16(headers, 56, programHeaderCount);

  // One read/execute segment contains the complete launcher and payload.
  uint32(headers, elfHeaderSize, 1); // PT_LOAD
  uint32(headers, elfHeaderSize + 4, 5); // PF_R | PF_X
  uint64(headers, elfHeaderSize + 16, elfBaseAddress);
  uint64(headers, elfHeaderSize + 24, elfBaseAddress);
  uint64(headers, elfHeaderSize + 32, fileSize);
  uint64(headers, elfHeaderSize + 40, fileSize);
  uint64(headers, elfHeaderSize + 48, 4096);

  // Explicitly request a non-executable process stack.
  const stack = elfHeaderSize + programHeaderSize;
  uint32(headers, stack, 0x6474e551); // PT_GNU_STACK
  uint32(headers, stack + 4, 6); // PF_R | PF_W
  uint64(headers, stack + 48, 16);
  return headers;
}

function launcherCode(strings) {
  const bytes = [];
  const ripPatches = [];
  const emit = (...values) => bytes.push(...values);
  const ripAddress = (prefix, name) => {
    emit(...prefix);
    const displacementAt = bytes.length;
    emit(0, 0, 0, 0);
    ripPatches.push({ displacementAt, name });
  };

  emit(0x49, 0x89, 0xe4); // mov r12, rsp
  emit(0x4c, 0x8b, 0x2c, 0x24); // mov r13, [rsp]
  emit(0x4e, 0x8d, 0x74, 0xec, 0x10); // lea r14, [rsp + r13*8 + 16]
  emit(0x4c, 0x89, 0xe8); // mov rax, r13
  emit(0x48, 0x83, 0xc0, 0x05); // add rax, 5
  emit(0x48, 0xc1, 0xe0, 0x03); // shl rax, 3
  emit(0x48, 0x29, 0xc4); // sub rsp, rax
  emit(0x48, 0x83, 0xe4, 0xf0); // and rsp, -16
  emit(0x49, 0x89, 0xe7); // mov r15, rsp

  for (const [index, name] of ["envName", "nodeName", "evalFlag", "evaluator"].entries()) {
    ripAddress([0x48, 0x8d, 0x05], name); // lea rax, [rip + string]
    emit(0x49, 0x89, 0x47, index * 8); // mov [r15 + offset], rax
  }

  emit(0x48, 0x31, 0xc9); // xor rcx, rcx
  const loopAt = bytes.length;
  emit(0x4c, 0x39, 0xe9); // cmp rcx, r13
  emit(0x7d, 0); // jge done
  const doneJumpAt = bytes.length - 1;
  emit(0x49, 0x8b, 0x44, 0xcc, 0x08); // mov rax, [r12 + rcx*8 + 8]
  emit(0x49, 0x89, 0x44, 0xcf, 0x20); // mov [r15 + rcx*8 + 32], rax
  emit(0x48, 0xff, 0xc1); // inc rcx
  emit(0xeb, 0); // jmp loop
  bytes[bytes.length - 1] = loopAt - bytes.length;
  bytes[doneJumpAt] = bytes.length - doneJumpAt - 1;

  emit(0x49, 0x8d, 0x45, 0x04); // lea rax, [r13 + 4]
  emit(0x49, 0xc7, 0x04, 0xc7, 0, 0, 0, 0); // mov qword [r15 + rax*8], 0
  emit(0xb8, 59, 0, 0, 0); // mov eax, SYS_execve
  ripAddress([0x48, 0x8d, 0x3d], "envPath"); // lea rdi, [rip + /usr/bin/env]
  emit(0x4c, 0x89, 0xfe); // mov rsi, r15
  emit(0x4c, 0x89, 0xf2); // mov rdx, r14
  emit(0x0f, 0x05); // syscall
  emit(0xbf, 127, 0, 0, 0); // mov edi, 127
  emit(0xb8, 60, 0, 0, 0); // mov eax, SYS_exit
  emit(0x0f, 0x05); // syscall

  const code = Buffer.from(bytes);
  for (const { displacementAt, name } of ripPatches) {
    const nextInstruction = codeOffset + displacementAt + 4;
    code.writeInt32LE(strings[name] - nextInstruction, displacementAt);
  }
  return code;
}

export function embeddedNodeExecutable(payload, rootLevels) {
  if (!Buffer.isBuffer(payload) || payload.length < 1) throw new Error("embedded payload is required");
  if (!Number.isSafeInteger(rootLevels) || rootLevels < 1) throw new Error("root level count is invalid");

  const evaluator = [
    "const fs=require('node:fs'),M=require('node:module'),p=require('node:path'),",
    "f=fs.realpathSync(process.argv[1]);let r=f;",
    `for(let i=0;i<${rootLevels};i++)r=p.dirname(r);`,
    "process.env.OMAPILOT_PLUGIN_ROOT=r;const m=new M(f);m.filename=f;",
    `m.paths=M._nodeModulePaths(p.dirname(f));m._compile(fs.readFileSync(f).subarray(${payloadOffset}).toString(),f);`
  ].join("");
  const values = {
    envPath: "/usr/bin/env",
    envName: "env",
    nodeName: "node",
    evalFlag: "-e",
    evaluator
  };
  const stringBuffers = Object.fromEntries(Object.entries(values).map(([name, value]) => (
    [name, Buffer.from(`${value}\0`, "utf8")]
  )));
  const strings = {};
  let stringOffset = codeOffset;
  const placeholderCodeLength = launcherCode(Object.fromEntries(Object.keys(values).map((name) => [name, 0]))).length;
  stringOffset += placeholderCodeLength;
  for (const [name, buffer] of Object.entries(stringBuffers)) {
    strings[name] = stringOffset;
    stringOffset += buffer.length;
  }
  if (stringOffset > payloadOffset) throw new Error("embedded launcher metadata exceeds its fixed prefix");

  const code = launcherCode(strings);
  const prefix = Buffer.concat([
    elfHeaders(payloadOffset + payload.length),
    code,
    ...Object.values(stringBuffers),
    Buffer.alloc(payloadOffset - stringOffset)
  ]);
  if (prefix.length !== payloadOffset) throw new Error("embedded launcher prefix has an invalid size");
  return Buffer.concat([prefix, payload]);
}
