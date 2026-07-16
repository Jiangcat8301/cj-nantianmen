<template>
  <Teleport to="body">
    <div v-if="visible" class="fixed inset-0 z-50 flex items-center justify-center" @click.self="onBackdrop">
      <div class="bg-gray-800 border border-gray-600 rounded-lg shadow-2xl w-96 p-0" @click.stop>
        <div class="p-5">
          <h3 class="text-sm font-semibold text-gray-200 mb-3">{{ title }}</h3>
          <p v-if="message" class="text-sm text-gray-400 mb-4">{{ message }}</p>
          <input
            v-if="mode === 'prompt'"
            ref="inputEl"
            v-model="inputVal"
            type="text"
            :placeholder="placeholder"
            class="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm text-gray-200 focus:border-emerald-500 focus:outline-none mb-4"
            @keyup.enter="resolve(inputVal)"
          />
        </div>
        <div class="flex justify-end gap-2 px-5 pb-5">
          <button v-if="mode === 'confirm' || mode === 'prompt'" @click="resolve(null)"
            class="px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 rounded text-gray-300 transition">
            {{ cancelText }}
          </button>
          <button @click="resolve(inputVal)"
            class="px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 rounded text-white font-medium transition">
            {{ okText }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, nextTick, watch } from 'vue'

const visible = ref(false)
const mode = ref('alert') // alert | confirm | prompt
const title = ref('')
const message = ref('')
const placeholder = ref('')
const okText = ref('确定')
const cancelText = ref('取消')
const inputVal = ref('')
const inputEl = ref(null)

let _resolve = null

function onBackdrop() {
  if (mode.value !== 'prompt') resolve(null)
}

function resolve(val) {
  visible.value = false
  if (_resolve) {
    const v = mode.value === 'confirm' ? val : val
    _resolve(v)
    _resolve = null
  }
}

function show(opts) {
  mode.value = opts.mode || 'alert'
  title.value = opts.title || ''
  message.value = opts.message || ''
  placeholder.value = opts.placeholder || ''
  okText.value = opts.okText || '确定'
  cancelText.value = opts.cancelText || '取消'
  inputVal.value = opts.value || ''
  visible.value = true
  // ponytail: auto-focus input on prompt
  if (opts.mode === 'prompt') {
    nextTick(() => inputEl.value?.focus())
  }
  return new Promise((r) => { _resolve = r })
}

defineExpose({ show })
</script>
