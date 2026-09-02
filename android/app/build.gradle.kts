plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.voxenmc.bedrockai"
    compileSdk = 35
    // pin to what is installed; the plugin default is a version we do not have
    ndkVersion = "27.1.12297006"

    defaultConfig {
        applicationId = "com.voxenmc.bedrockai"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"

        externalNativeBuild {
            cmake { arguments += listOf("-DANDROID_STL=c++_shared") }
        }
    }

    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
            version = "3.22.1"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    // libnode ships for these three only, and is about 60 MB each, so one apk
    // carrying all of them would be pointless. Each phone gets just its own.
    // This is also what limits the build to those architectures - an abiFilters
    // list as well is rejected as a conflicting configuration.
    splits {
        abi {
            isEnable = true
            reset()
            include("arm64-v8a", "armeabi-v7a", "x86_64")
            isUniversalApk = false
        }
    }

    // libnode.so is already stripped and must not be compressed, or dlopen
    // cannot map it straight out of the apk
    packaging {
        jniLibs {
            useLegacyPackaging = false
            keepDebugSymbols += "**/libnode.so"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
}
