// Starts the Node runtime that nodejs-mobile ships as libnode.so.
//
// node::Start never returns until the process is meant to end, so it is called
// on its own Java thread. Everything the bridge does after that - the http
// server, the websocket, the model calls - happens inside Node exactly as it
// does on a desktop; this file only hands it an argv and gets out of the way.

#include <jni.h>
#include <android/log.h>
#include <string>
#include <vector>
#include <unistd.h>
#include <pthread.h>

#define TAG "BedrockAI"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, TAG, __VA_ARGS__)

// nodejs-mobile exports the C++ entry point, not a C one: the only start
// symbol in libnode.so is _ZN4node5StartEiPPc. Declaring it in the namespace
// reproduces that mangling exactly.
namespace node {
int Start(int argc, char *argv[]);
}

namespace {

// Node writes to stdout and stderr, which Android drops on the floor unless
// something is reading them. This pumps both into logcat so the app's own log
// view can show what the bridge is doing.
int stdoutPipe[2];
pthread_t logThread;

void *pumpOutput(void *) {
    ssize_t size;
    char buf[512];
    while ((size = read(stdoutPipe[0], buf, sizeof(buf) - 1)) > 0) {
        if (buf[size - 1] == '\n') size--;
        buf[size] = 0;
        LOGI("%s", buf);
    }
    return nullptr;
}

void captureOutput() {
    setvbuf(stdout, nullptr, _IOLBF, 0);
    setvbuf(stderr, nullptr, _IONBF, 0);
    if (pipe(stdoutPipe) != 0) return;
    dup2(stdoutPipe[1], STDOUT_FILENO);
    dup2(stdoutPipe[1], STDERR_FILENO);
    pthread_create(&logThread, nullptr, pumpOutput, nullptr);
    pthread_detach(logThread);
}

}  // namespace

extern "C" JNIEXPORT jint JNICALL
Java_com_voxenmc_bedrockai_NodeEngine_nativeStart(JNIEnv *env, jclass, jobjectArray args) {
    static bool capturing = false;
    if (!capturing) {
        captureOutput();
        capturing = true;
    }

    const jsize count = env->GetArrayLength(args);
    std::vector<std::string> owned;
    owned.reserve(count);
    for (jsize i = 0; i < count; i++) {
        auto item = (jstring) env->GetObjectArrayElement(args, i);
        const char *chars = env->GetStringUTFChars(item, nullptr);
        owned.emplace_back(chars);
        env->ReleaseStringUTFChars(item, chars);
        env->DeleteLocalRef(item);
    }

    std::vector<char *> argv;
    argv.reserve(owned.size() + 1);
    for (auto &s : owned) argv.push_back(const_cast<char *>(s.c_str()));
    argv.push_back(nullptr);

    LOGI("starting node with %d arguments", (int) owned.size());
    return node::Start((int) owned.size(), argv.data());
}
